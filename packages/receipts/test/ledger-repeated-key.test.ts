/**
 * A ledger line that cannot be read one way, and the head record's byte count (2026-10-19; from a cold review, 2026-10-13:
 * the reviewer's files are in fixtures/ledger-cold-review-2026-10-13/, copied byte for byte; its README names where they came
 * from).
 *
 * The reviewer rewrote a signed entry's body as `"decision":"EXECUTE","decision":"HOLD"`. JSON.parse keeps the last value, so the
 * entry's hash re-derived over HOLD, the pinned key's signature verified, and `riposte-ledger verify --key` printed OK, exit 0,
 * while a reader that keeps the first value (a grep, a log pipeline) saw EXECUTE on a bill the gate held. The file had grown by
 * 21 bytes, and the head record beside it, which records the file's byte length, said so; verify did not read that field.
 *
 * Now every line is read under the engine's hash contract (verify's parseJsonStrict, the reader the replay path already uses): a
 * key written twice in one object, or a number whose text does not read back as written, breaks the chain at that entry, exit 1,
 * naming the line and the JSON path. The head record's byte count is checked against the file: the bytes up to the end of the
 * entry it names must be the bytes it records, as the file store already checks when it opens a ledger.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createPrivateKey, sign as edSign } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateSigningKeypair } from 'riposte-verify'
import {
  checkHeadRecord, entryHash, fileStore, headRecordPathOf, ledgerCli, LEDGER_HELP, openLedger, parseLedger, parseLedgerTolerant,
  verifyChain, type LedgerEntry,
} from '../src/index.js'
import { readLedgerText } from '../src/ledger-command.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const FX = join(HERE, 'fixtures', 'ledger-cold-review-2026-10-13')
const fx = (...p: string[]): string => join(FX, ...p)
const readFile = (p: string): string => readFileSync(p, 'utf8')
const H0 = (JSON.parse(readFile(fx('receipts.jsonl.head.json'))) as { head: string }).head
const KEY = ['--key', fx('pub.pem')]
const dirs: string[] = []
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })
const scratch = (): string => { const d = mkdtempSync(join(tmpdir(), 'riposte-repeated-key-')); dirs.push(d); return d }
type J = Record<string, any>
const verifyOf = (argv: string[], read = readFile): { code: number; out: J; lines: string[]; err: string } => {
  const r = ledgerCli(['verify', ...argv], read)
  return { code: r.code, out: r.out ? JSON.parse(r.out) as J : {}, lines: r.err.split('\n').filter(Boolean), err: r.err }
}

describe('the reviewer\'s repeated-key entry (case-dupkey-conflict) does not verify', () => {
  it('with the pinned key: exit 1, "BROKEN: chain", entry 2 named with the line and the path of the repeated key', () => {
    const r = verifyOf([fx('case-dupkey-conflict', 'receipts.jsonl'), ...KEY])
    expect(r.code).toBe(1)
    expect(r.lines[0]).toBe('BROKEN: chain')
    expect(r.lines[1]).toBe('BROKEN at entry 2: entry 2 cannot be read one way: line 3: the key "decision" appears twice in one object (at $.body.decision). JSON keeps the last, so the entry\'s hash and signature cover that value, while a reader that keeps the first sees the other. The receipts store writes every key once, so something else wrote this line')
    expect(r.err).not.toMatch(/^OK/m)
    expect(Object.keys(r.out)[0]).toBe('ok')
    expect(r.out).toMatchObject({ ok: false, chain_ok: false, signatures_ok: true, broken_at: 2, length: 5 })
    expect(r.out.reason).toContain('(at $.body.decision)')
    // the chain holds up to the entry before it, so `head` is entry 1's
    const e1 = (JSON.parse(readFile(fx('case-dupkey-conflict', 'receipts.jsonl')).split('\n')[1]!) as LedgerEntry).hash
    expect(r.out.head).toBe(e1)
  })

  it('without the head record (--no-sidecar): still exit 1; the strict reading alone catches it', () => {
    const r = verifyOf([fx('case-dupkey-conflict', 'receipts.jsonl'), ...KEY, '--no-sidecar'])
    expect(r.code).toBe(1)
    expect(r.out).toMatchObject({ ok: false, chain_ok: false, broken_at: 2 })
  })

  it('with the head record: its byte count shows the file grew by 21 bytes, said beside the broken chain', () => {
    const r = verifyOf([fx('case-dupkey-conflict', 'receipts.jsonl'), ...KEY])
    expect(r.out.head_record).toMatchObject({ status: 'rewritten', ok: false, count: 5, bytes: 2632, file_bytes: 2653 })
    expect(r.err).toContain('head record: the file holds 2653 bytes up to the end of entry 4; its head record (receipts.jsonl.head.json) says 2632')
  })

  it('summary refuses it too: exit 1, chain_ok false, the reason named', () => {
    const s = ledgerCli(['summary', fx('case-dupkey-conflict', 'receipts.jsonl')], readFile)
    expect(s.code).toBe(1)
    const out = JSON.parse(s.out) as J
    expect(out).toMatchObject({ entries: 5, chain_ok: false })
    expect(out.reason).toContain('the key "decision" appears twice in one object (at $.body.decision)')
  })

  it('the reviewer\'s other repeated key ("seq":1,"seq":1 on entry 1): exit 1 at entry 1, path $.seq', () => {
    const r = verifyOf([fx('case-dup_key_in_entry_line', 'receipts.jsonl'), ...KEY])
    expect(r.code).toBe(1)
    expect(r.out).toMatchObject({ ok: false, chain_ok: false, broken_at: 1 })
    expect(r.lines[1]).toMatch(/^BROKEN at entry 1: entry 1 cannot be read one way: line 2: the key "seq" appears twice in one object \(at \$\.seq\)\./)
  })
})

describe('every other case the reviewer ran keeps its documented answer', () => {
  // the reviewer's attack.mjs, one row per case folder it wrote: [folder, arguments, exit]
  const K = KEY
  const cases: [string, string[], number][] = [
    ['case-pristine', [], 0], ['case-pristine___key', K, 0],
    ['case-edit_body_of_entry_3__HOLD__EXECUTE_', K, 1], ['case-reorder_2___3', K, 1], ['case-delete_entry_3', K, 1],
    ['case-cut_last_2__original_head_record', K, 1], ['case-cut_last_2__head_record_deleted', K, 1],
    ['case-cut_last_2__head_deleted____no_sidecar', [...K, '--no-sidecar'], 0],
    // a cut whose head record was recomputed to match passes: the record sits beside the file, so it is not an anchor (--help)
    ['case-cut_last_2__head_recomputed', K, 0], ['case-cut_last_2__head_recomputed____head_H0', [...K, '--head', H0], 1],
    // a rewrite with every hash recomputed passes without an anchor, and fails with one
    ['case-edit_rechain_unsigned__head_recomputed', [], 0], ['case-edit_rechain_unsigned____key', K, 1],
    ['case-edit_rechain_re_signed_attacker_key__no___key', [], 0], ['case-edit_rechain_re_signed_attacker_key____key', K, 1],
    ['case-edit_rechain_re_signed____head_H0', ['--head', H0], 1], ['case-torn_tail', K, 1],
    // the two repeated-key cases: exit 0 before 2026-10-19
    ['case-dup_key_in_entry_line', K, 1], ['case-dupkey-conflict', K, 1],
  ]
  for (const [dir, args, code] of cases) {
    it(`${dir}: exit ${code}, and ok agrees with the exit`, () => {
      const r = verifyOf([fx(dir, 'receipts.jsonl'), ...args])
      expect(r.code).toBe(code)
      expect(r.out.ok).toBe(code === 0)
      expect(/^OK: /.test(r.err)).toBe(code === 0)
    })
  }
  it('a recomputed head record carries the file\'s byte count, so it agrees (the documented limit stands)', () => {
    const r = verifyOf([fx('case-cut_last_2__head_recomputed', 'receipts.jsonl'), ...KEY])
    expect(r.out.head_record).toMatchObject({ status: 'agrees', ok: true })
    expect(r.out.head_record.bytes).toBe(r.out.head_record.file_bytes)
  })
})

/** A five-entry signed ledger written by the file store, its lines, and the public key on disk. */
function five(): { dir: string; L: string; pub: string; lines: string[]; entries: LedgerEntry[]; key: ReturnType<typeof generateSigningKeypair> } {
  const dir = scratch()
  const L = join(dir, 'r.jsonl')
  const key = generateSigningKeypair()
  const l = openLedger(fileStore(L), { signingKey: key.privateKeyPem })
  for (let i = 0; i < 5; i++) l.append('ap_gate', { bill: `B${i + 1}`, decision: i === 2 ? 'HOLD' : 'EXECUTE', amount: i === 3 ? 9007199254740992 : 1000 * (i + 1) })
  const pub = join(dir, 'pub.pem')
  writeFileSync(pub, key.publicKeyPem)
  return { dir, L, pub, lines: readFile(L).split('\n').filter(Boolean), entries: l.entries(), key }
}
const rewrite = (L: string, lines: string[]): void => writeFileSync(L, `${lines.join('\n')}\n`)

describe('the head record\'s byte count is enforced', () => {
  it('a space added inside an entry (its hash, its signature, every key unchanged): only the byte count shows it, exit 1', () => {
    const { L, pub, lines } = five()
    lines[1] = lines[1]!.replace('"kind":', ' "kind":')
    rewrite(L, lines)
    expect(verifyOf([L, '--key', pub, '--no-sidecar']).code).toBe(0) // every entry still reads, chains and verifies
    const r = verifyOf([L, '--key', pub])
    expect(r.code).toBe(1)
    expect(r.lines[0]).toMatch(/^BROKEN: the file holds (\d+) bytes up to the end of entry 4; its head record \(r\.jsonl\.head\.json\) says (\d+) \(head [0-9a-f]{16}…, the same entry\): bytes were added to or removed from the entries it covers, so the file was rewritten; verify against a head you recorded elsewhere \(--head <hash>\)$/)
    expect(r.out.head_record).toMatchObject({ status: 'rewritten', ok: false })
    expect(r.out.head_record.file_bytes - r.out.head_record.bytes).toBe(1)
    expect(r.out).toMatchObject({ ok: false, chain_ok: true, signatures_ok: true })
  })

  it('a record behind the file: the bytes it records are checked at the entry it names, and the rest still chains', () => {
    const { L, entries, lines } = five()
    const through3 = Buffer.byteLength(lines.slice(0, 3).map((l) => `${l}\n`).join(''), 'utf8')
    writeFileSync(headRecordPathOf(L), JSON.stringify({ version: 1, ledger: 'r.jsonl', count: 3, head: entries[2]!.hash, bytes: through3 }))
    expect(verifyOf([L]).code).toBe(0)
    writeFileSync(headRecordPathOf(L), JSON.stringify({ version: 1, ledger: 'r.jsonl', count: 3, head: entries[2]!.hash, bytes: through3 + 7 }))
    const r = verifyOf([L])
    expect(r.code).toBe(1)
    expect(r.out.head_record).toMatchObject({ status: 'rewritten', bytes: through3 + 7, file_bytes: through3 })
  })

  it('a record without a byte count is not { count, head, bytes }: not verified, as the file store refuses it', () => {
    const { L, entries } = five()
    writeFileSync(headRecordPathOf(L), JSON.stringify({ version: 1, ledger: 'r.jsonl', count: 5, head: entries[4]!.hash }))
    const r = verifyOf([L])
    expect(r.code).toBe(1)
    expect(r.lines[0]).toMatch(/^NOT VERIFIED: the head record r\.jsonl\.head\.json is not \{ count, head, bytes \}, so it cannot say where the ledger ends/)
  })

  it('a whole last entry with no newline after it still verifies (the newline the store wrote is counted)', () => {
    const { L, pub } = five()
    writeFileSync(L, readFile(L).replace(/\n$/, ''))
    const r = verifyOf([L, '--key', pub])
    expect(r.code).toBe(0)
    expect(r.err).toContain('note: the last line has no newline')
  })

  it('a line-ending conversion (CR LF) is a rewrite of the file, and the words say what a conversion does', () => {
    const { L, pub } = five()
    writeFileSync(L, readFile(L).replace(/\n/g, '\r\n'))
    const r = verifyOf([L, '--key', pub])
    expect(r.code).toBe(1)
    expect(r.out.head_record.file_bytes - r.out.head_record.bytes).toBe(5)
    expect(r.lines[0]).toContain('its lines end in CR LF, and a line-ending conversion adds one byte per line')
  })

  it('checkHeadRecord alone, with no byte layout given, reads { count, head } as before', () => {
    const { entries } = five()
    expect(checkHeadRecord(entries, 'x.head.json', JSON.stringify({ count: 5, head: entries[4]!.hash })).status).toBe('agrees')
  })
})

describe('the same class: a number whose text does not read back as written', () => {
  it('9007199254740992 rewritten as 9007199254740993 (same length, reads as the same double): exit 1, naming the path', () => {
    const { L, pub, lines } = five()
    expect(lines[3]).toContain('"amount":9007199254740992')
    lines[3] = lines[3]!.replace('"amount":9007199254740992', '"amount":9007199254740993')
    rewrite(L, lines)
    expect(verifyChain(parseLedgerTolerant(readFile(L), { refusals: 'collect' }).entries)).toMatchObject({ ok: true }) // the hash re-derives over the double
    const r = verifyOf([L, '--key', pub])
    expect(r.code).toBe(1)
    expect(r.out).toMatchObject({ ok: false, chain_ok: false, broken_at: 3 })
    expect(r.lines[1]).toMatch(/^BROKEN at entry 3: entry 3 cannot be read one way: line 4: the number at \$\.body\.amount \(9007199254740993\) is a number that cannot be represented exactly/)
    expect(r.out.head_record).toMatchObject({ status: 'agrees' }) // the byte count cannot see it; the strict reading does
  })
})

describe('the library readers refuse such a line by default, so every reader of a ledger file fails closed', () => {
  const text = readFile(fx('case-dupkey-conflict', 'receipts.jsonl'))
  it('parseLedger and parseLedgerTolerant throw, naming the entry, the line and the path', () => {
    expect(() => parseLedger(text)).toThrow(/^entry 2 cannot be read one way: line 3: the key "decision" appears twice in one object \(at \$\.body\.decision\)/)
    expect(() => parseLedgerTolerant(text)).toThrow(/entry 2 cannot be read one way: line 3/)
  })
  it('collected instead (what verify and summary do): the entries as JSON.parse reads them, and the first refusal', () => {
    const p = parseLedgerTolerant(text, { refusals: 'collect' })
    expect(p.entries).toHaveLength(5)
    expect(p.refused).toMatchObject({ entry: 2, line: 3, path: '$.body.decision' })
    const c = verifyChain(p.entries, {}, { refused: p.refused })
    expect(c).toMatchObject({ ok: false, chain_ok: false, broken_at: 2 })
    expect(verifyChain(p.entries)).toMatchObject({ ok: true }) // the parsed values alone chain: that was the hole
  })
  it('a genuine ledger reads exactly as before', () => {
    const g = readFile(fx('receipts.jsonl'))
    expect(parseLedger(g)).toEqual(g.split('\n').filter(Boolean).map((l) => JSON.parse(l)))
    expect(parseLedgerTolerant(g, { refusals: 'collect' }).refused).toBeUndefined()
  })
})

describe('rule refuses to append to a ledger with such a line', () => {
  it('through the file store (the bin\'s path) and through a raw append', () => {
    const d = scratch()
    const L = join(d, 'r.jsonl')
    copyFileSync(fx('case-dupkey-conflict', 'receipts.jsonl'), L)
    // a head record recomputed to match the edited file, so the file store opens it and only the strict reading can refuse
    writeFileSync(`${L}.head.json`, JSON.stringify({ version: 1, ledger: 'r.jsonl', count: 5, head: H0, bytes: readFileSync(L).length }))
    const before = readFile(L)
    const argv = ['rule', L, '--verdict', 'a'.repeat(32), '--by', 'controller', '--decision', 'allow', '--note', 'n', '--rules', 'R1']
    const viaStore = ledgerCli(argv, readFile, { openStore: (p) => fileStore(p) })
    expect(viaStore.code).not.toBe(0)
    expect(viaStore.code).toBe(1)
    expect(viaStore.err).toContain('refusing to append: the chain does not verify (entry 2: entry 2 cannot be read one way: line 3: the key "decision" appears twice')
    const viaAppend = ledgerCli(argv, readFile, { append: () => { throw new Error('must not append') } })
    expect(viaAppend.code).toBe(1)
    expect(viaAppend.err).toContain('refusing to append: the chain does not verify (entry 2: entry 2 cannot be read one way: line 3')
    expect(readFile(L)).toBe(before)
  })
})

describe('the bin reads every file as UTF-8 and refuses bytes that are not', () => {
  it('U+FFFD (EF BF BD) in a string swapped for one 0xFF byte: refused, naming the byte offset', () => {
    const { L } = five()
    const good = Buffer.from(readFile(L).replace('"bill":"B2"', '"bill":"B�"'), 'utf8')
    expect(readLedgerText(good, 'r.jsonl')).toBe(good.toString('utf8'))
    const at = good.indexOf(Buffer.from([0xef, 0xbf, 0xbd]))
    const bad = Buffer.concat([good.subarray(0, at), Buffer.from([0xff]), good.subarray(at + 3)])
    expect(() => readLedgerText(bad, 'r.jsonl')).toThrow(`r.jsonl is not valid UTF-8 at byte ${at}`)
    // a head record that is not UTF-8 is unreadable, never missing: the command cannot read it (exit 3)
    writeFileSync(`${L}.head.json`, Buffer.from([0x7b, 0xff, 0x7d]))
    const r = ledgerCli(['verify', L], (p) => readLedgerText(readFileSync(p), p))
    expect(r.code).toBe(3)
    expect(r.err).toContain('cannot read the head record')
  })
})

describe('--help says what verify now reads', () => {
  it('the strict reading and the byte count, under what each check catches and under exit 1', () => {
    const h = LEDGER_HELP.replace(/\s+/g, ' ')
    expect(h).toContain('a key written twice in one object')
    expect(h).toContain('its byte count')
    expect(h).toContain('a line the strict reader refuses')
  })
})

describe('a forged entry signed by the key holder over the first value', () => {
  it('re-signing the EXECUTE reading cannot help: the line still repeats a key', () => {
    const { L, pub, lines, entries, key } = five()
    // the holder writes the entry with EXECUTE, signs it properly, then appends the old value after it
    const e = { ...entries[2]!, body: { bill: 'B3', decision: 'EXECUTE', amount: 3000 } } as LedgerEntry
    e.hash = entryHash(e)
    e.signature = { alg: 'ed25519', public_key: key.publicKeyPem, sig: edSign(null, Buffer.from(e.hash, 'utf8'), createPrivateKey(key.privateKeyPem)).toString('base64') }
    lines[2] = JSON.stringify(e).replace('"decision":"EXECUTE"', '"decision":"HOLD","decision":"EXECUTE"')
    rewrite(L, lines)
    const r = verifyOf([L, '--key', pub, '--no-sidecar'])
    expect(r.code).toBe(1)
    expect(r.out.broken_at).toBe(2)
  })
})
