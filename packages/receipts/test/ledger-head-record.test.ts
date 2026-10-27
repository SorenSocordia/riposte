/**
 * 2026-10-05: a four-entry signed ledger cut to three in place verified OK with the issuer's key pinned,
 * while the head record beside it (`<ledger>.head.json`) still said four. `riposte-ledger verify` now reads that record by
 * default and refuses, in words, a file shorter than it or whose entry at its head is another one. The record is written by
 * the same process, so it adds a refusal and never removes one: `--head` is checked whatever it says. A pinned key needs
 * every entry signed by it (a rewrite with its signatures stripped passed `--key` alone before).
 */
import { describe, it, expect, afterAll } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createPrivateKey, sign as edSign } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateSigningKeypair } from 'riposte-verify'
import {
  checkHeadRecord, entryHash, fileStore, headRecordFor, headRecordPathOf, ledgerCli, LEDGER_HELP, openLedger, replayAgainstLedger, replayCli, sidecarPathOf,
  verifyChain, GENESIS, type LedgerEntry,
} from '../src/index.js'

// the public export's own scan, when this file runs in the lab tree (it does not ship beside the public package)
const scanUrl = new URL('../../riposte-export-scan.mjs', import.meta.url)
const scan: ((rel: string, buf: Buffer) => string[]) | undefined = existsSync(fileURLToPath(scanUrl)) ? (await import(scanUrl.href)).scanFile : undefined
const key = generateSigningKeypair()
const other = generateSigningKeypair()
const dirs: string[] = []
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })
const readFile = (p: string): string => readFileSync(p, 'utf8')
const lines = (p: string): string[] => readFileSync(p, 'utf8').split('\n').filter(Boolean)
const write = (p: string, ls: string[]): void => writeFileSync(p, ls.length ? `${ls.join('\n')}\n` : '')

/** A four-entry signed ledger written by the file store (so it has its head record), and the issuer's public key. */
function four(): { dir: string; L: string; pub: string; head: string; entries: LedgerEntry[] } {
  const dir = mkdtempSync(join(tmpdir(), 'riposte-head-record-'))
  dirs.push(dir)
  const L = join(dir, 'ledger.jsonl')
  const pub = join(dir, 'pub.pem')
  writeFileSync(pub, key.publicKeyPem)
  const l = openLedger(fileStore(L), { signingKey: key.privateKeyPem })
  for (let i = 0; i < 4; i++) l.append('note', { n: i, text: `entry ${i}` })
  const entries = l.entries()
  return { dir, L, pub, head: entries[3]!.hash, entries }
}

describe('riposte-ledger verify reads the head record beside the file', () => {
  it('the file store and verify name the same record', () => {
    expect(headRecordPathOf('a/b/ledger.jsonl')).toBe(sidecarPathOf('a/b/ledger.jsonl'))
  })

  it('a full ledger: OK, exit 0, and the head record agrees', () => {
    const { L, pub, head } = four()
    const r = ledgerCli(['verify', L, '--key', pub], readFile)
    expect(r.code).toBe(0)
    expect(r.err).toMatch(/^OK: 4 entries/)
    expect(r.err).toContain(`head record ledger.jsonl.head.json: 4 entries, head ${head.slice(0, 16)}…, as in the file`)
    expect(r.err).toContain('--head <hash>, recorded somewhere you control, is the anchor')
    expect(JSON.parse(r.out)).toMatchObject({ ok: true, length: 4, head_record: { status: 'agrees', ok: true, count: 4, head } })
  })

  it('the tail cut in place, its head record left beside it: refused, exit 1, in words; the first line never says OK', () => {
    const { L, pub, head } = four()
    write(L, lines(L).slice(0, 3))
    const r = ledgerCli(['verify', L, '--key', pub], readFile)
    expect(r.code).toBe(1)
    expect(r.err.split('\n')[0]).toBe(`BROKEN at the tail: the file has 3 entries; its head record (ledger.jsonl.head.json) says 4 (head ${head.slice(0, 16)}…); the last entry was removed or the file was rewritten; verify against a head you recorded elsewhere (--head <hash>)`)
    expect(r.err).not.toMatch(/^OK/m)
    expect(r.err).toContain('the entries in the file chain correctly on their own (3 entries')
    expect(JSON.parse(r.out)).toMatchObject({ ok: false, length: 3, head_record: { status: 'cut', ok: false, count: 4 } })
    // two entries cut: the count is said
    const b = four()
    write(b.L, lines(b.L).slice(0, 2))
    expect(ledgerCli(['verify', b.L], readFile).err).toContain('the last 2 entries were removed')
  })

  it('the tail cut and the head record deleted: NOT verified, exit 1, in words, unless --no-sidecar (2026-10-05)', () => {
    const { L, pub } = four()
    write(L, lines(L).slice(0, 3))
    rmSync(headRecordPathOf(L))
    const r = ledgerCli(['verify', L, '--key', pub], readFile)
    expect(r.code).toBe(1)
    expect(r.err.split('\n')[0]).toBe('NOT VERIFIED: no head record found (ledger.jsonl.head.json), so a cut at the end of the file, or the record deleted with it, would not show: verify against a head you recorded elsewhere (--head <hash>) as well, and pass --no-sidecar to verify without the record when this ledger never had one')
    expect(r.err).not.toMatch(/^OK/m)
    expect(r.err).toContain('the entries in the file chain correctly on their own (3 entries')
    expect(JSON.parse(r.out)).toMatchObject({ ok: false, chain_ok: true, signatures_ok: true, head_record: { status: 'absent', ok: false } })
    // --no-sidecar is the stated way to verify without it, and says what that leaves open
    const ns = ledgerCli(['verify', L, '--key', pub, '--no-sidecar'], readFile)
    expect(ns.code).toBe(0)
    expect(ns.err).toMatch(/^OK: 3 entries/)
    expect(ns.err).toContain('note: head record not read (--no-sidecar); truncation cannot be detected without an anchor')
    // summary only reports it (it is not a verification)
    const s = ledgerCli(['summary', L], readFile)
    expect([s.code, JSON.parse(s.out).head_record.status]).toEqual([0, 'absent'])
  })

  it('an entry deleted in the middle: refused by the chain, exit 1', () => {
    const { L, pub } = four()
    const ls = lines(L)
    write(L, [ls[0]!, ls[2]!, ls[3]!])
    const r = ledgerCli(['verify', L, '--key', pub], readFile)
    expect(r.code).toBe(1)
    // 2026-10-13: the first line is "BROKEN: chain"; the entry follows on the next (ledger-tails-and-broken-chain.test.ts)
    expect(r.err).toMatch(/^BROKEN: chain\nBROKEN at entry 1: entry 1 has seq 2/)
  })

  it('--head that is not in the chain: refused, exit 1; the head record cannot rescue it', () => {
    const { L, pub, head, entries } = four()
    write(L, lines(L).slice(0, 3))
    // whoever cut the file also rewrote the record to match: the record agrees, the --head recorded elsewhere does not
    writeFileSync(headRecordPathOf(L), JSON.stringify({ version: 1, ledger: 'ledger.jsonl', count: 3, head: entries[2]!.hash, bytes: readFileSync(L).length }))
    expect(ledgerCli(['verify', L, '--key', pub], readFile).code).toBe(0) // the record beside the file is only as good as the file
    const r = ledgerCli(['verify', L, '--key', pub, '--head', head], readFile)
    expect(r.code).toBe(1)
    // the chain itself holds: the first line says NOT VERIFIED, never BROKEN, and the anchor has its own field
    expect(r.err).toMatch(/^NOT VERIFIED: the anchored hash .* is not in this chain \(rewritten or truncated since it was recorded\); the hash chain itself holds \(3 entries/)
    expect(JSON.parse(r.out)).toMatchObject({ ok: false, chain_ok: true, signatures_ok: true, anchor_ok: false })
  })

  it('--head given and the record shows a cut past it: still refused (the record adds a refusal, never removes one)', () => {
    const { L, pub, entries } = four()
    write(L, lines(L).slice(0, 3))
    const r = ledgerCli(['verify', L, '--key', pub, '--head', entries[1]!.hash], readFile)
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/^BROKEN at the tail: the file has 3 entries/)
  })

  it('--no-sidecar skips the record, and says so', () => {
    const { L, pub, entries } = four()
    write(L, lines(L).slice(0, 3))
    const r = ledgerCli(['verify', L, '--key', pub, '--no-sidecar'], readFile)
    expect(r.code).toBe(0)
    expect(r.err).toContain('note: head record not read (--no-sidecar); truncation cannot be detected without an anchor')
    const anchored = ledgerCli(['verify', L, '--key', pub, '--no-sidecar', '--head', entries[2]!.hash], readFile)
    expect(anchored.code).toBe(0)
    expect(anchored.err).toContain('note: head record not read (--no-sidecar); the --head you gave is the anchor')
  })

  it('the last entry rewritten and re-signed by the key holder, record left alone: refused as rewritten', () => {
    const { L, pub, entries } = four()
    const last: LedgerEntry = { ...entries[3]!, body: { n: 3, text: 'paid twice' } }
    last.hash = entryHash(last)
    last.signature = { alg: 'ed25519', public_key: key.publicKeyPem, sig: edSign(null, Buffer.from(last.hash, 'utf8'), createPrivateKey(key.privateKeyPem)).toString('base64') }
    write(L, [...lines(L).slice(0, 3), JSON.stringify(last)])
    // the pinned key cannot catch its own holder: the chain and the signatures hold
    expect(ledgerCli(['verify', L, '--key', pub, '--no-sidecar'], readFile).code).toBe(0)
    const r = ledgerCli(['verify', L, '--key', pub], readFile)
    expect(r.code).toBe(1)
    expect(r.err.startsWith('BROKEN: entry 3 is not the one its head record (ledger.jsonl.head.json) names (the record says head ')).toBe(true)
    expect(r.err).toContain('; the file was rewritten; verify against a head you recorded elsewhere (--head <hash>)\n')
    expect(r.err).toContain('a consistent chain is what a rewrite by the key holder looks like')
    expect(JSON.parse(r.out).head_record.status).toBe('rewritten')
    // the head recorded elsewhere catches it too
    expect(ledgerCli(['verify', L, '--key', pub, '--no-sidecar', '--head', entries[3]!.hash], readFile).code).toBe(1)
  })

  it('a record behind the file (an append it had not caught up with): verifies, and says how many came after', () => {
    const { L, entries } = four()
    // 2026-10-19: the byte count is checked too (ledger-repeated-key.test.ts), so the record carries the file's length up to entry 2
    const bytes = Buffer.byteLength(lines(L).slice(0, 3).map((l) => `${l}\n`).join(''), 'utf8')
    writeFileSync(headRecordPathOf(L), JSON.stringify({ version: 1, ledger: 'ledger.jsonl', count: 3, head: entries[2]!.hash, bytes }))
    const r = ledgerCli(['verify', L], readFile)
    expect(r.code).toBe(0)
    expect(r.err).toContain('the file holds 1 more, chained after it')
  })

  it('a record that does not parse: not verified, exit 1, naming --no-sidecar', () => {
    const { L } = four()
    writeFileSync(headRecordPathOf(L), '{ not json')
    const r = ledgerCli(['verify', L], readFile)
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/^NOT VERIFIED: the head record ledger\.jsonl\.head\.json does not parse, so it cannot say where the ledger ends; delete it, or pass --no-sidecar/)
  })

  it('summary carries the head record and exits 1 on a cut', () => {
    const { L } = four()
    write(L, lines(L).slice(0, 3))
    const s = ledgerCli(['summary', L], readFile)
    expect(s.code).toBe(1)
    expect(JSON.parse(s.out)).toMatchObject({ entries: 3, chain_ok: true, head_record: { status: 'cut' } })
    expect(ledgerCli(['summary', L, '--no-sidecar'], readFile).code).toBe(0)
  })

  it('riposte-replay --ledger reports the cut as not intact, from the same head record', () => {
    const { L } = four()
    write(L, lines(L).slice(0, 3))
    const cut = lines(L).map((l) => JSON.parse(l) as LedgerEntry)
    const hr = headRecordFor(L, cut, readFile, false)
    if ('error' in hr) throw new Error(hr.error)
    const r = replayAgainstLedger(cut, { entry: '0', headRecord: hr })
    expect(r.intact).toBe(false)
    expect(r.warnings.join(' | ')).toContain('the last entry was removed or the file was rewritten')
    const skipped = headRecordFor(L, cut, readFile, true)
    if ('error' in skipped) throw new Error(skipped.error)
    expect(replayAgainstLedger(cut, { entry: '0', headRecord: skipped }).intact).toBe(true)
    // the CLI reads it too: --no-sidecar is accepted, an unknown flag is not
    const fsx = { readFile, listDir: () => undefined, join: (d: string, n: string) => join(d, n) }
    expect(replayCli(['--ledger', L, '--entry', '0', '--no-sidecar'], fsx).err).toContain('carries no proof object')
    expect(replayCli(['--ledger', L, '--entry', '0', '--bogus'], fsx).code).toBe(3)
  })
})

describe('a pinned key needs every entry signed by it', () => {
  it('a rewrite with an edited entry and every signature stripped fails --key alone (it passed before 2026-10-05)', () => {
    const { L, pub } = four()
    let prev = GENESIS
    const out = lines(L).map((l) => JSON.parse(l) as LedgerEntry).map((e) => {
      if (e.seq === 1) (e.body as { text: string }).text = 'forged'
      e.prev_hash = prev
      delete e.signature
      e.hash = entryHash(e)
      prev = e.hash
      return JSON.stringify(e)
    })
    write(L, out)
    rmSync(headRecordPathOf(L))
    expect(verifyChain(out.map((l) => JSON.parse(l)))).toMatchObject({ ok: true }) // the chain alone: internally consistent
    const r = ledgerCli(['verify', L, '--key', pub, '--no-sidecar'], readFile)
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/^NOT VERIFIED: entry 0 is not signed, and a pinned key needs every entry signed by it/)
    expect(JSON.parse(r.out)).toMatchObject({ ok: false, chain_ok: true, signatures_ok: false, broken_at: 0 })
  })

  it('a ledger signed by another key still fails as before', () => {
    const dir = mkdtempSync(join(tmpdir(), 'riposte-head-other-'))
    dirs.push(dir)
    const L = join(dir, 'l.jsonl')
    const l = openLedger(fileStore(L), { signingKey: other.privateKeyPem })
    l.append('note', { x: 1 })
    writeFileSync(join(dir, 'pub.pem'), key.publicKeyPem)
    const r = ledgerCli(['verify', L, '--key', join(dir, 'pub.pem')], readFile)
    expect(r.err).toMatch(/^NOT VERIFIED: entry 0 is signed by key [0-9a-f]{64}, not the expected [0-9a-f]{64} \(re-signed by someone else\?\); the hash chain itself holds/)
    // 2026-10-05: an intact chain with the wrong key is chain_ok: true; the key's answer is signatures_ok
    expect(JSON.parse(r.out)).toMatchObject({ ok: false, chain_ok: true, signatures_ok: false })
    expect(r.code).toBe(1)
  })
})

describe('riposte-ledger --help says how a ledger is written and what each check catches', () => {
  it('names the append, the writers, and the limits of a pinned key and of the head record', () => {
    const h = ledgerCli(['--help'], readFile)
    expect(h.code).toBe(0)
    expect(h.err).toBe(`${LEDGER_HELP}\n`)
    expect(LEDGER_HELP).toContain("openLedger(fileStore('receipts.jsonl'), { signingKey }).append(kind, body)")
    expect(LEDGER_HELP).toContain('riposte-pilot shadow (one per bill')
    expect(LEDGER_HELP).toContain('It does NOT catch a clean cut at the\n                        tail')
    expect(LEDGER_HELP).toContain('whoever can rewrite the file can rewrite\n                        or delete the record too')
    expect(LEDGER_HELP).toContain('--no-sidecar')
    expect(ledgerCli(['verify', '--help'], readFile).code).toBe(0)
    // a usage error prints the short usage, not the whole page
    const bad = ledgerCli(['verify', 'x.jsonl', '--bogus'], () => '')
    expect(bad.code).toBe(3)
    expect(bad.err).not.toContain('How a ledger is written')
  })
  it.skipIf(!scan)('the help text passes the export scan (no house words)', () => {
    expect(scan!('emitted/riposte-ledger-help.txt', Buffer.from(LEDGER_HELP))).toEqual([])
  })
})

describe('checkHeadRecord on its own', () => {
  it('an empty record over an empty file agrees; over a grown file it is behind; a bad empty head is unreadable', () => {
    expect(checkHeadRecord([], 'x.head.json', JSON.stringify({ count: 0, head: GENESIS })).status).toBe('agrees')
    const { entries } = four()
    expect(checkHeadRecord(entries, 'x.head.json', JSON.stringify({ count: 0, head: GENESIS })).status).toBe('behind')
    expect(checkHeadRecord([], 'x.head.json', JSON.stringify({ count: 0, head: 'a'.repeat(64) }))).toMatchObject({ status: 'unreadable', ok: false })
    expect(checkHeadRecord(entries, 'x.head.json', JSON.stringify({ count: -1, head: GENESIS }))).toMatchObject({ status: 'unreadable', ok: false })
  })
})
