/**
 * 2026-10-03: the file ledger under failure and at volume, and binding a customer's proof to a hashes-only receipt.
 *   3  a torn last line (a crash mid-append) is quarantined byte for byte, recorded as a signed note, reported by verify,
 *      and the ledger continues
 *   4  a head sidecar makes an append O(1); a sidecar that does not match the file is refused by name; verify still walks
 *      the whole chain; 20k rows, append latency flat
 *   5  `riposte-ledger verify --proof` and `riposte-replay --ledger --proof` recompute the verdict hash from the customer's
 *      proof and compare it with the receipt's verdict_sha256 (and its documents); a mismatch names the entry
 */
import { describe, it, expect, afterAll } from 'vitest'
import { appendFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateSigningKeypair } from 'riposte-verify'
import {
  entryHash, fileStore, handleMcpRequest, ledgerCli, LedgerStoreError, openLedger, replayCli, sha256Hex,
  sidecarPathOf, verifyChain, GENESIS, type LedgerEntry, type ReplayFs,
} from '../src/index.js'
// Public modules only (this file ships with the public package); the hosted gate's cases are in test/hosted-r2.test.ts.

const HERE = dirname(fileURLToPath(import.meta.url))
const CASES = readFileSync(join(HERE, '..', '..', 'verify', 'data', 'real', 'D-ap-distil', 'invoice_cases.jsonl'), 'utf8').trim().split('\n')
  .map((l) => JSON.parse(l) as { id: string; input: string; decision: string })
const APPROVE = CASES.find((c) => c.id === 'T003')!.input

const key = generateSigningKeypair()
const dirs: string[] = []
const tmp = (): string => { const d = mkdtempSync(join(tmpdir(), 'riposte-r2-ledger-')); dirs.push(d); return d }
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })
const readFile = (p: string): string => readFileSync(p, 'utf8')
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex')
const codeOf = (f: () => unknown): string | undefined => { try { f(); return undefined } catch (e) { return e instanceof LedgerStoreError ? e.code : `not a LedgerStoreError: ${(e as Error).message}` } }

/** Cut the file in the middle of its last line, as a crash mid-append leaves it; returns the bytes that remain of that line. */
function tearLastLine(path: string): Buffer {
  const full = readFileSync(path)
  const start = full.subarray(0, full.length - 1).lastIndexOf(0x0a) + 1
  const cut = start + Math.floor((full.length - 1 - start) / 2)
  truncateSync(path, cut)
  return full.subarray(start, cut)
}

describe('a torn last line does not brick the ledger', () => {
  const five = () => {
    const dir = tmp()
    const L = join(dir, 'receipts.jsonl')
    const pub = join(dir, 'pub.pem')
    writeFileSync(pub, key.publicKeyPem)
    const l = openLedger(fileStore(L), { signingKey: key.privateKeyPem })
    for (let i = 0; i < 5; i++) l.append('note', { i, text: 'x'.repeat(60) })
    return { dir, L, pub, l }
  }

  it('a crash mid-append (the row being written cut mid-row): quarantined byte for byte, a signed note, verify reports it, the ledger continues', () => {
    const { dir, L, pub, l } = five()
    const h = l.head()
    const half: LedgerEntry = { seq: h.count, kind: 'note', at: '2026-10-03T01:00:00.000Z', body: { i: 5, text: 'y'.repeat(60) }, prev_hash: h.head, hash: '' }
    half.hash = entryHash(half)
    const row = Buffer.from(JSON.stringify(half))
    const torn = row.subarray(0, Math.floor(row.length / 2))
    appendFileSync(L, torn) // the process died here: half a row, no newline, the sidecar never told

    const before = ledgerCli(['verify', L, '--key', pub], readFile)
    expect(before.code).toBe(1)
    expect(before.err).toContain('TORN TAIL: the file ends in an unfinished line')
    // 2026-10-05: `ok` agrees with the exit code; the chain's own answer is `chain_ok`
    expect(before.err).toMatch(/^NOT VERIFIED: torn tail\./)
    expect(JSON.parse(before.out)).toMatchObject({ ok: false, chain_ok: true, length: 5, torn_tail: { bytes: torn.length, after_line: 5 } })
    expect(JSON.parse(before.out).reason).toContain('torn tail')

    const reopened = openLedger(fileStore(L), { signingKey: key.privateKeyPem })
    const next = reopened.append('note', { after: 'the repair' })
    const q = readdirSync(dir).filter((n) => n.startsWith('receipts.jsonl.torn-'))
    expect(q).toHaveLength(1)
    expect(readFileSync(join(dir, q[0]!)).equals(torn)).toBe(true)
    const entries = reopened.entries()
    expect(entries).toHaveLength(7) // the 5 entries, the repair's note, the next append
    expect(entries[5]!.body).toMatchObject({ event: 'ledger.torn_tail_quarantined', bytes: torn.length, sha256: sha(torn), quarantined_to: q[0], after_seq: 4 })
    expect(entries[5]!.body).not.toHaveProperty('cut_entry')
    expect(entries[5]!.signature).toBeDefined()
    expect(next.seq).toBe(6)

    const after = ledgerCli(['verify', L, '--key', pub, '--require-signed'], readFile)
    expect(after.code).toBe(0)
    expect(after.err).toContain(`quarantined: entry 5 records a torn tail of ${torn.length} bytes (sha256 ${sha(torn).slice(0, 16)}…) moved to ${q[0]} after entry 4\n`)
    expect(JSON.parse(after.out).repairs).toEqual([{ seq: 5, bytes: torn.length, sha256: sha(torn), quarantined_to: q[0], after_seq: 4 }])
  })

  it('the last committed row truncated mid-row (a disk fault or an edit): not bricked either; the note names the entry that was cut', () => {
    const { dir, L, pub, l } = five()
    const lost = l.entries()[4]!
    const torn = tearLastLine(L)
    const reopened = openLedger(fileStore(L), { signingKey: key.privateKeyPem })
    expect(reopened.append('note', { after: 'the repair' }).seq).toBe(5)
    const q = readdirSync(dir).filter((n) => n.startsWith('receipts.jsonl.torn-'))
    expect(readFileSync(join(dir, q[0]!)).equals(torn)).toBe(true)
    const entries = reopened.entries()
    expect(entries.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4, 5]) // 4 whole entries, the note, the next append
    expect(entries[4]!.body).toMatchObject({ event: 'ledger.torn_tail_quarantined', bytes: torn.length, after_seq: 3, cut_entry: { seq: 4, hash: lost.hash } })
    const after = ledgerCli(['verify', L, '--key', pub, '--require-signed'], readFile)
    expect(after.code).toBe(0)
    expect(after.err).toContain(`the cut went through entry 4 (hash ${lost.hash.slice(0, 16)}…), which had been written`)
  })

})

describe('the head sidecar: O(1) appends, a mismatch refused by name', () => {
  const fill = (n: number) => {
    const dir = tmp()
    const L = join(dir, 'receipts.jsonl')
    const l = openLedger(fileStore(L), { signingKey: key.privateKeyPem })
    for (let i = 0; i < n; i++) l.append('note', { i })
    return { dir, L, l }
  }

  it('after each append the sidecar holds the count, the head and the byte length', () => {
    const { L, l } = fill(3)
    const side = JSON.parse(readFileSync(sidecarPathOf(L), 'utf8'))
    expect(side).toMatchObject({ version: 1, ledger: 'receipts.jsonl', count: 3, head: l.entries()[2]!.hash, bytes: statSync(L).size })
  })

  it('a file cut short, an edited head entry, or a sidecar that does not parse: refused, each with its own code', () => {
    const a = fill(3)
    const text = readFileSync(a.L, 'utf8')
    writeFileSync(a.L, text.slice(0, text.lastIndexOf('\n', text.length - 2) + 1)) // the last whole entry removed
    expect(codeOf(() => openLedger(fileStore(a.L)).append('note', {}))).toBe('ledger.sidecar_mismatch')

    const b = fill(3)
    writeFileSync(b.L, readFileSync(b.L, 'utf8').replace('"i":2', '"i":7')) // same length, another entry
    expect(codeOf(() => openLedger(fileStore(b.L)).append('note', {}))).toBe('ledger.sidecar_mismatch')

    const c = fill(2)
    writeFileSync(sidecarPathOf(c.L), '{ not json')
    expect(codeOf(() => openLedger(fileStore(c.L)).entries())).toBe('ledger.sidecar_invalid')

    const d = fill(2)
    rmSync(d.L)
    expect(codeOf(() => openLedger(fileStore(d.L)).append('note', {}))).toBe('ledger.sidecar_mismatch')
  })

  it('another writer\'s chained line is taken in (riposte-ledger rule does this); one that does not chain is refused', () => {
    const { L, l } = fill(2)
    const head = l.head()
    const outside: LedgerEntry = { seq: head.count, kind: 'note', at: '2026-10-03T00:00:00.000Z', body: { by: 'another writer' }, prev_hash: head.head, hash: '' }
    outside.hash = entryHash(outside)
    appendFileSync(L, `${JSON.stringify(outside)}\n`)
    expect(l.append('note', { mine: true }).seq).toBe(3) // continues after the outside line, no fork
    expect(verifyChain(l.entries()).ok).toBe(true)
    const stray = { ...outside, seq: 4, prev_hash: GENESIS }
    appendFileSync(L, `${JSON.stringify(stray)}\n`)
    expect(codeOf(() => l.append('note', {}))).toBe('ledger.changed_outside')
  })

  it('a ledger written before the sidecar existed gets one on open, from one scan', () => {
    const { L } = fill(4)
    rmSync(sidecarPathOf(L))
    const l = openLedger(fileStore(L))
    expect(l.head().count).toBe(4)
    expect(JSON.parse(readFileSync(sidecarPathOf(L), 'utf8')).count).toBe(4)
  })

  it('20,000 rows: append latency stays flat, open with the sidecar is quick, and verify still walks the whole chain', () => {
    const dir = tmp()
    const L = join(dir, 'receipts.jsonl')
    const N = 20_000
    let prev = GENESIS
    const lines: string[] = []
    for (let i = 0; i < N; i++) {
      const e: LedgerEntry = { seq: i, kind: 'ap_gate', at: new Date(Date.UTC(2026, 9, 1) + i * 1000).toISOString(), body: { stored: 'hashes', key_id: 'alpha', verdict_id: sha256Hex(`v${i}`).slice(0, 32), pad: 'h'.repeat(400) }, prev_hash: prev, hash: '' }
      e.hash = entryHash(e)
      prev = e.hash
      lines.push(JSON.stringify(e))
    }
    writeFileSync(L, `${lines.join('\n')}\n`)
    const timeAppends = (l: ReturnType<typeof openLedger>, n: number): number[] => {
      const ms: number[] = []
      for (let i = 0; i < n; i++) { const t0 = performance.now(); l.append('ap_gate', { stored: 'hashes', key_id: 'alpha', pad: 'h'.repeat(400) }); ms.push(performance.now() - t0) }
      return ms.sort((a, b) => a - b)
    }
    const q = (s: number[], p: number): number => s[Math.min(s.length - 1, Math.floor(p * s.length))]!
    let t0 = performance.now()
    const big = openLedger(fileStore(L))
    big.head() // no sidecar yet: one scan builds it
    const firstOpen = performance.now() - t0
    const atBig = timeAppends(big, 200)
    t0 = performance.now()
    const again = openLedger(fileStore(L))
    again.head() // the sidecar, validated in O(1)
    const sidecarOpen = performance.now() - t0
    const fresh = openLedger(fileStore(join(tmp(), 'receipts.jsonl')))
    const atZero = timeAppends(fresh, 200)
    const report = { rows: N, first_open_ms: +firstOpen.toFixed(1), sidecar_open_ms: +sidecarOpen.toFixed(1), append_ms_at_0: { p50: +q(atZero, 0.5).toFixed(3), p95: +q(atZero, 0.95).toFixed(3) }, append_ms_at_20k: { p50: +q(atBig, 0.5).toFixed(3), p95: +q(atBig, 0.95).toFixed(3) } }
    console.log(`ledger scale: ${JSON.stringify(report)}`)
    expect(q(atBig, 0.5)).toBeLessThan(3 * q(atZero, 0.5) + 1)
    expect(sidecarOpen).toBeLessThan(firstOpen)
    const all = again.entries()
    expect(all).toHaveLength(N + 200)
    expect(verifyChain(all)).toMatchObject({ ok: true, length: N + 200 })
    const cli = ledgerCli(['verify', L], readFile)
    expect(cli.code).toBe(0)
    expect(cli.err).toContain(`OK: ${N + 200} entries`)
  })
})

describe('the customer\'s proof is bound to its hashes-only receipt by verdict_sha256', () => {
  // A hashes-only receipt on a file ledger, and the proof its caller kept (the MCP tool here; the hosted gate writes the same
  // receipt body, test/hosted-r2.test.ts).
  const dir = tmp()
  const L = join(dir, 'receipts.jsonl')
  const ledger = openLedger(fileStore(L), { signingKey: key.privateKeyPem })
  // an empty book (history: []): the duplicate check runs, so the gate can approve (with no book the checker abstains, since 2026-10-05)
  const answer = (handleMcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ap_gate', arguments: { decision: 'approve', layout: APPROVE, history: [] } } }, { ledger, read: () => ({}) }) as { result: { structuredContent: Record<string, any> } }).result.structuredContent
  expect(answer.receipt.stored).toBe('hashes')
  expect(sha256Hex(answer.proof.inputs.ap.invoice)).toBe((ledger.entries()[0]!.body as { documents: { invoice: { sha256: string } } }).documents.invoice.sha256)
  const write = (name: string, x: unknown): string => { const p = join(dir, name); writeFileSync(p, JSON.stringify(x)); return p }
  const proof = write('proof.json', answer.proof)
  const tampered = structuredClone(answer.proof)
  tampered.verdict.claims[0].explanation += ' (edited)'
  const tamperedPath = write('tampered.json', tampered)
  const otherDoc = structuredClone(answer.proof)
  otherDoc.inputs.ap.invoice = otherDoc.inputs.ap.invoice.replace('Invoice NM-32009 for', 'Invoice NM-32009 For')
  const otherDocPath = write('other-doc.json', otherDoc)
  const fs: ReplayFs = { readFile, listDir: () => undefined, join: (d, n) => join(d, n) }

  it('riposte-ledger verify --proof: the kept proof binds; a tampered verdict names the entry and verdict_sha256; a changed document names its hash', () => {
    const ok = ledgerCli(['verify', L, '--proof', proof], readFile)
    expect(ok.code).toBe(0)
    expect(ok.err).toContain(`BOUND: ${proof} ↔ entry 0`)
    expect(JSON.parse(ok.out).bindings).toEqual([{ proof, entry: 0, bound: true }])
    const bad = ledgerCli(['verify', L, '--proof', tamperedPath], readFile)
    expect(bad.code).toBe(1)
    expect(bad.err).toContain(`NOT BOUND: ${tamperedPath} at entry 0: verdict_sha256: the proof's verdict hashes to`)
    const doc = ledgerCli(['verify', L, '--proof', otherDocPath, '--entry', '0'], readFile)
    expect(doc.code).toBe(1)
    expect(JSON.parse(doc.out).bindings[0]).toMatchObject({ entry: 0, bound: false, field: 'documents.invoice.sha256' })
    expect(ledgerCli(['verify', L, '--entry', '0'], readFile).code).toBe(3) // --entry names the receipt for a --proof
  })

  it('riposte-replay --ledger --proof: a bound proof replays (MATCH, with the gate line); a tampered one is DIVERGED at verdict_sha256, naming the entry', () => {
    const ok = replayCli(['--ledger', L, '--proof', proof], fs)
    expect(ok.code).toBe(0)
    expect(JSON.parse(ok.out)).toMatchObject({ matched: 1, bindings: [{ entry: 0, bound: true }], cases: [{ result: 'MATCH', answer: 'PASS', gate: { decision: 'approve' } }] })
    expect(ok.err).toContain('APPROVE (gate: the check pays) · verdict PASS')
    const bad = replayCli(['--ledger', L, '--entry', '0', '--proof', tamperedPath], fs)
    expect(bad.code).toBe(1)
    expect(JSON.parse(bad.out).cases[0]).toMatchObject({ result: 'DIVERGED', first_difference: 'verdict_sha256' })
    expect(bad.err).toContain('NOT BOUND to entry 0')
  })
})
