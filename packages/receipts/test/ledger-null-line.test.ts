/**
 * A ledger line that is JSON but not an object (2026-10-20; found by the Python reader of the record, pinned by the record's
 * conformance vectors). A line `null` passed the strict line reader (it is one JSON value, read one way), and verify then read
 * `.seq` of null: `TypeError: Cannot read properties of null (reading 'seq')`, exit 1, and no verdict line. summary threw on
 * `.kind`, `rule --sign-only` on `.body`, the head record's check on `.hash`, and `verify --proof` while looking for the receipt.
 *
 * Now a null line breaks the chain at that entry, in words: "entry N is not a ledger entry (the line is JSON null)", the words
 * the Python reader (conformance/engine_py/record/ledger.py) already gives, so the two agree on the exit, the first line and the
 * reason. A line that is an array, a number, a string or a boolean already broke the chain at that entry ("entry N has seq
 * undefined"); those words are pinned here as they are, because both readers give them.
 *
 * The head record's check, the receipt lookup behind --proof, and an --entry given as a hash prefix (riposte-ledger and
 * riposte-replay --ledger) read the same lines: each now passes over a line that is not an object instead of throwing. The hash
 * prefix lookup threw on an array or a number line too, before today's case. When the head record's head is such a line, its
 * words say "entry N is not a ledger entry", where they used to say "the file has undefined… there".
 */
import { describe, it, expect } from 'vitest'
import { generateSigningKeypair } from 'riposte-verify'
import { headRecordPathOf, ledgerCli, memoryStore, openLedger, replayCli, verifyChain, type LedgerEntry } from '../src/index.js'

type J = Record<string, any>
const keys = generateSigningKeypair()
const entries: LedgerEntry[] = (() => {
  let t = Date.parse('2026-10-20T09:00:00.000Z')
  const L = openLedger(memoryStore(), { signingKey: keys.privateKeyPem, now: () => new Date((t += 2000)) })
  L.append('decision', { decision: 'HOLD', item: 'INV-1001' })
  L.append('note', { event: 'example', text: 'a note on the record' })
  L.append('done_check', { outcome: 'PASS', checked: 3 })
  return L.entries()
})()
const lines = entries.map((e) => JSON.stringify(e))
const VID = '0123456789abcdef0123456789abcdef'

/** In-memory files; a missing one reads as ENOENT, as the bin's readFile does. */
const filesOf = (f: Record<string, string>) => (p: string): string => {
  const t = f[p]
  if (t === undefined) throw Object.assign(new Error(`ENOENT: no such file, open '${p}'`), { code: 'ENOENT' })
  return t
}
/** The ledger with line `at` replaced by `token`; `record`: the head record the store wrote before the edit. */
const ledgerWith = (token: string, at: number, record = false): Record<string, string> => {
  const text = lines.map((l, i) => (i === at ? token : l)).join('\n') + '\n'
  const f: Record<string, string> = { 'l.jsonl': text, 'k.pub.pem': keys.publicKeyPem, 'k.pem': keys.privateKeyPem }
  if (record) {
    const bytes = Buffer.byteLength(lines.join('\n') + '\n', 'utf8')
    f[headRecordPathOf('l.jsonl')] = `${JSON.stringify({ version: 1, ledger: 'l.jsonl', count: 3, head: entries[2]!.hash, bytes, updated_at: '2026-10-20T09:00:07.000Z' })}\n`
  }
  return f
}
const run = (argv: string[], f: Record<string, string>, io = {}): { code: number; out: J | undefined; lines: string[]; err: string } => {
  let r: { code: number; out: string; err: string } | undefined
  expect(() => { r = ledgerCli(argv, filesOf(f), io) }).not.toThrow()
  let out: J | undefined
  try { out = JSON.parse(r!.out) as J } catch { out = undefined }
  return { code: r!.code, out, lines: r!.err.split('\n').filter(Boolean), err: r!.err }
}

const NOT_OBJECTS = ['null', '[]', '5', '"x"', 'true']
const reasonFor = (token: string, at: number): string =>
  token === 'null' ? `entry ${at} is not a ledger entry (the line is JSON null)` : `entry ${at} has seq undefined (reordered or removed entries)`

describe('verify: a line that is not an object breaks the chain at that entry, with a verdict line', () => {
  for (const token of NOT_OBJECTS) {
    for (const at of [0, 1, 2]) {
      it(`${token} as entry ${at}: exit 1, "BROKEN: chain", the entry named, never an exception`, () => {
        const r = run(['verify', 'l.jsonl', '--no-sidecar'], ledgerWith(token, at))
        expect(r.code).toBe(1)
        expect(r.lines[0]).toBe('BROKEN: chain')
        expect(r.lines[1]).toBe(`BROKEN at entry ${at}: ${reasonFor(token, at)}`)
        expect(r.out).toMatchObject({ ok: false, chain_ok: false, broken_at: at, length: 3, reason: reasonFor(token, at) })
        expect(Object.keys(r.out!)[0]).toBe('ok')
        // the chain holds up to the entry before it
        expect(r.out!.head).toBe(at === 0 ? '0'.repeat(64) : entries[at - 1]!.hash)
      })
    }
  }

  it('a file whose one line is null (the reported case): exit 1 with the verdict line', () => {
    const r = run(['verify', 'l.jsonl', '--no-sidecar'], { 'l.jsonl': 'null\n' })
    expect(r.code).toBe(1)
    expect(r.lines.slice(0, 2)).toEqual(['BROKEN: chain', 'BROKEN at entry 0: entry 0 is not a ledger entry (the line is JSON null)'])
    expect(r.out).toMatchObject({ ok: false, chain_ok: false, broken_at: 0, length: 1, signed: 0, unsigned: 1 })
  })

  it('with the pinned key, null after the signed entries: the chain is what breaks; the null line counts as unsigned, as in the Python reader', () => {
    const f = ledgerWith('null', 99)
    f['l.jsonl'] = lines.join('\n') + '\nnull\n'
    const r = run(['verify', 'l.jsonl', '--key', 'k.pub.pem', '--no-sidecar'], f)
    expect(r.code).toBe(1)
    expect(r.lines[0]).toBe('BROKEN: chain')
    expect(r.lines[1]).toBe('BROKEN at entry 3: entry 3 is not a ledger entry (the line is JSON null)')
    expect(r.out).toMatchObject({ ok: false, chain_ok: false, signatures_ok: true, broken_at: 3, length: 4, signed: 3, unsigned: 1, head: entries[2]!.hash })
  })

  it('with --require-signed: the same answer, never an exception', () => {
    const r = run(['verify', 'l.jsonl', '--require-signed', '--no-sidecar'], ledgerWith('null', 1))
    expect(r.code).toBe(1)
    expect(r.out).toMatchObject({ ok: false, chain_ok: false, broken_at: 1, reason: reasonFor('null', 1) })
  })

  it('with the head record the store wrote, whose head is the entry the null line replaced: exit 1, "BROKEN: chain"', () => {
    const r = run(['verify', 'l.jsonl'], ledgerWith('null', 2, true))
    expect(r.code).toBe(1)
    expect(r.lines[0]).toBe('BROKEN: chain')
    expect(r.out).toMatchObject({ ok: false, chain_ok: false, broken_at: 2 })
    expect(r.out!.head_record).toMatchObject({ status: 'rewritten', ok: false })
  })

  for (const token of NOT_OBJECTS) {
    it(`the head record's words when its head is a line that is ${token}: "entry 2 is not a ledger entry", never "undefined"`, () => {
      const r = run(['verify', 'l.jsonl'], ledgerWith(token, 2, true))
      expect(r.code).toBe(1)
      expect(r.out!.head_record.words).toBe(`entry 2 is not a ledger entry, so it is not the one its head record (l.jsonl.head.json) names (the record says head ${entries[2]!.hash.slice(0, 16)}…); the file was rewritten; verify against a head you recorded elsewhere (--head <hash>)`)
      expect(r.err).toContain(`head record: entry 2 is not a ledger entry, so it is not the one its head record`)
      expect(r.err).not.toContain('undefined…')
    })
  }

  it('the head record\'s words when its head is another whole entry: unchanged, the hash the file has there', () => {
    const f = ledgerWith('null', 99, true)
    const other = { ...entries[2]!, hash: 'f'.repeat(64) }
    f['l.jsonl'] = [lines[0], lines[1], JSON.stringify(other)].join('\n') + '\n'
    const r = run(['verify', 'l.jsonl'], f)
    expect(r.out!.head_record.words).toBe(`entry 2 is not the one its head record (l.jsonl.head.json) names (the record says head ${entries[2]!.hash.slice(0, 16)}…; the file has ffffffffffffffff… there); the file was rewritten; verify against a head you recorded elsewhere (--head <hash>)`)
  })

  it('with --proof: the proof does not bind (no receipt carries its verdict), and the chain answer leads', () => {
    const f = ledgerWith('null', 1)
    f['p.json'] = JSON.stringify({ verdict: { verdict_id: VID }, inputs: [] })
    const r = run(['verify', 'l.jsonl', '--proof', 'p.json', '--no-sidecar'], f)
    expect(r.code).toBe(1)
    expect(r.lines[0]).toBe('BROKEN: chain')
    expect(r.out!.bindings).toEqual([expect.objectContaining({ bound: false, entry: null, field: 'entry' })])
  })

  it('with --proof --entry <hash prefix> past a line that is not an object: no entry has that hash, in words', () => {
    for (const token of ['null', '[]', '5']) {
      const f = ledgerWith(token, 1)
      f['p.json'] = JSON.stringify({ verdict: { verdict_id: VID }, inputs: [] })
      const r = run(['verify', 'l.jsonl', '--proof', 'p.json', '--entry', 'deadbeef', '--no-sidecar'], f)
      expect(r.code, token).toBe(1)
      expect(r.lines[0], token).toBe('BROKEN: chain')
      expect(r.out!.bindings, token).toEqual([expect.objectContaining({ bound: false, entry: null, field: 'entry', reason: 'no entry deadbeef on the ledger' })])
    }
  })
})

describe('verifyChain reads through the same path', () => {
  it('a null entry in the array: broken there, the entries around it still counted, never an exception', () => {
    const arr = [entries[0]!, null as unknown as LedgerEntry, entries[2]!]
    let c: ReturnType<typeof verifyChain> | undefined
    expect(() => { c = verifyChain(arr, { publicKey: keys.publicKeyPem }) }).not.toThrow()
    expect(c).toMatchObject({ ok: false, chain_ok: false, broken_at: 1, reason: reasonFor('null', 1), length: 3, head: entries[0]!.hash, signed: 2, unsigned: 1 })
  })
})

describe('summary and rule read the same path', () => {
  for (const token of NOT_OBJECTS) {
    it(`summary with ${token} as entry 1: exit 1, chain_ok false, the reason named`, () => {
      const r = run(['summary', 'l.jsonl', '--no-sidecar'], ledgerWith(token, 1))
      expect(r.code).toBe(1)
      expect(r.out).toMatchObject({ entries: 3, chain_ok: false, reason: reasonFor(token, 1) })
      expect(r.out!.kinds).toEqual({ decision: 1, undefined: 1, done_check: 1 })
    })
  }

  it('summary with the head record whose head is the null line: exit 1, the record\'s words, never an exception', () => {
    const r = run(['summary', 'l.jsonl'], ledgerWith('null', 2, true))
    expect(r.code).toBe(1)
    expect(r.out).toMatchObject({ entries: 3, chain_ok: false, reason: reasonFor('null', 2) })
    expect(r.out!.head_record).toMatchObject({ status: 'rewritten', ok: false })
    expect(r.lines[0]).toMatch(/^entry 2 is not a ledger entry, so it is not the one its head record \(l\.jsonl\.head\.json\) names/)
  })

  it('rule refuses to append past a null line: exit 1, the chain\'s reason, nothing appended', () => {
    const appended: string[] = []
    const r = run(['rule', 'l.jsonl', '--verdict', VID, '--by', 'controller', '--decision', 'allow', '--note', 'n', '--rules', 'R1'],
      ledgerWith('null', 1), { append: (_p: string, t: string) => { appended.push(t) } })
    expect(r.code).toBe(1)
    expect(r.err).toBe('refusing to append: the chain does not verify (entry 1: entry 1 is not a ledger entry (the line is JSON null))\n')
    expect(appended).toEqual([])
  })

  it('rule --sign-only reads the ledger only to look for the verdict: a null line is passed over, as an array line is', () => {
    for (const token of ['null', '[]']) {
      const r = run(['rule', 'l.jsonl', '--verdict', VID, '--by', 'controller', '--decision', 'allow', '--note', 'n', '--rules', 'R1', '--key', 'k.pem', '--sign-only'], ledgerWith(token, 1))
      expect(r.code, token).toBe(0)
      expect(r.err, token).toMatch(/^ruling [0-9a-f]{32} signed \(not recorded\): controller allows R1 on verdict 0123456789abcdef0123456789abcdef only; its mandate was not checked here/)
    }
  })

  it('verify-signature does not walk a ledger: a file that is null is not an envelope, exit 3, in words', () => {
    const r = run(['verify-signature', 'e.json'], { 'e.json': 'null\n' })
    expect(r.code).toBe(3)
    expect(r.err).toBe('e.json: not a signed envelope, a replay bundle carrying one, or a verdict\n')
  })
})

describe('riposte-replay --ledger reads through the same guards', () => {
  const replay = (argv: string[], f: Record<string, string>): { code: number; out: string; err: string } => {
    let r: { code: number; out: string; err: string } | undefined
    expect(() => { r = replayCli(['--ledger', 'l.jsonl', ...argv], { readFile: filesOf(f), listDir: () => undefined, join: (a, b) => `${a}/${b}` }) }).not.toThrow()
    return r!
  }

  it('--entry <hash prefix> past a line that is null, an array or a number: no entry has that hash, exit 3, in words', () => {
    for (const token of ['null', '[]', '5']) {
      const r = replay(['--entry', 'deadbeef', '--no-sidecar'], ledgerWith(token, 1))
      expect(r.code, token).toBe(3)
      expect(r.err, token).toBe('no entry deadbeef on l.jsonl (3 entries; give a seq, or 8+ hex of its hash)\n')
    }
  })

  it('--proof past a null line: the proof does not bind, and the warning names the broken chain', () => {
    const f = ledgerWith('null', 1)
    f['p.json'] = JSON.stringify({ verdict: { verdict_id: VID }, inputs: [] })
    const r = replay(['--proof', 'p.json', '--no-sidecar'], f)
    expect(r.code).toBe(1)
    expect(r.err).toContain(`NOT BOUND: no ap_gate receipt on l.jsonl carries verdict ${VID}`)
    expect(r.err).toContain('warning: the ledger\'s chain does not verify (entry 1: entry 1 is not a ledger entry (the line is JSON null))')
  })

  it('with the head record whose head is the null line: answered in words, never an exception', () => {
    const r = replay(['--entry', '0'], ledgerWith('null', 2, true))
    expect(r.code).toBe(3)
    expect(r.err).toBe('entry 0 (decision) carries no proof object: only ap_gate receipts written since 2026-10-02 do\n')
  })
})
