/**
 * `verify anchor checkpoint|verify` (core-tidy, 2026-09-29): external anchoring at the command line, through run().
 *   - THE INSIDER REWRITE (the anchor lane's red-team case): a held FAIL is re-recorded as a PASS and the whole chain
 *     recomputed. The forged file verifies internally; `anchor verify` exits 2 at the first anchored position after the
 *     change, and `anchor checkpoint` refuses to extend it (exit 2), the witness store byte-identical.
 *   - Truncation past a checkpoint: exit 2, the position named.
 *   - Refusals (exit 1) and usage (exit 3) leave the witness store and the book byte-identical.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { createPrivateKey, createPublicKey } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { run, type CliIO } from '../src/cli'
import {
  verify, createLedger, parseChainJSONL, verifyChain, verifyChainAgainst, readDecisionBook, signDecision, makeKeyRegister,
  type Verdict, type Role,
} from '../src/index'
import { clean, broken, FIXED_NOW } from './fixtures/invoices'

function keyFromSeed(seedHex: string): { priv: string; pub: string } {
  const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(seedHex, 'hex')])
  const k = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })
  return { priv: k.export({ type: 'pkcs8', format: 'pem' }).toString(), pub: createPublicKey(k).export({ type: 'spki', format: 'pem' }).toString() }
}
const ROOT = keyFromSeed('a1'.repeat(32))
const OPS = keyFromSeed('11'.repeat(32))
const AUDITOR = keyFromSeed('77'.repeat(32))

const VERDICTS: Verdict[] = Array.from({ length: 10 }, (_, i) =>
  verify({ ...(i % 3 === 0 ? broken : clean), invoice_number: `AN-${i}` }, { now: FIXED_NOW }))

function makeBook(opts: { verdicts?: Verdict[]; witnessRoles?: Role[] } = {}) {
  let clock = Date.parse('2026-09-01T09:00:00.000Z')
  const tick = (): Date => new Date((clock += 60_000))
  const ledger = createLedger({ now: tick, ...(opts.witnessRoles ? { root_keys: [ROOT.pub] } : {}) })
  if (opts.witnessRoles) {
    ledger.decide(signDecision(makeKeyRegister({ subject_id: 'auditor', public_key: AUDITOR.pub, roles: opts.witnessRoles, signer_id: 'root', signed_at: new Date(clock).toISOString() }), ROOT.priv))
  }
  for (const v of opts.verdicts ?? VERDICTS) ledger.record(v, { tenant_id: 'acme' })
  return ledger
}
/** The insider's book: verdict 3 (a FAIL: a held payment) re-recorded as a coherent PASS, every hash recomputed. */
const forgedChain = (): string =>
  makeBook({ verdicts: VERDICTS.map((v, i) => (i === 3 ? verify({ ...clean, invoice_number: 'AN-3' }, { now: FIXED_NOW }) : v)) }).chainJSONL()

// ── files and IO ─────────────────────────────────────────────────────────────────────────────────────────────────────
const dirs: string[] = []
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })
function scratch(): string {
  const d = mkdtempSync(join(tmpdir(), 'verify-cli-anchor-'))
  dirs.push(d)
  return d
}
const put = (dir: string, name: string, content: string): string => { const p = join(dir, name); writeFileSync(p, content); return p }
function go(argv: string[]): { code: number; out: string; err: string; json: () => any } {
  let o = '', e = ''
  const io: CliIO = { out: s => { o += s }, err: s => { e += s } }
  const code = run(argv, io)
  return { code, out: o, err: e, json: () => JSON.parse(o) }
}
const bytes = (p: string): string | null => (existsSync(p) ? readFileSync(p, 'latin1') : null)

function setup() {
  const d = scratch()
  return {
    d,
    book: put(d, 'chain.jsonl', makeBook().chainJSONL()),
    key: put(d, 'auditor.pem', AUDITOR.priv),
    pub: put(d, 'auditor.pub.pem', AUDITOR.pub),
    wk: put(d, 'witness-keys.json', JSON.stringify({ auditor: AUDITOR.pub })),
    store: join(d, 'witness.jsonl'),
  }
}
const sign = (s: ReturnType<typeof setup>, book: string, extra: string[] = []) =>
  go(['anchor', 'checkpoint', '--ledger', book, '--key', s.key, '--signer', 'auditor', '--out', s.store, ...extra])
const check = (s: ReturnType<typeof setup>, book: string, extra: string[] = ['--trusted-keys', s.wk]) =>
  go(['anchor', 'verify', '--ledger', book, '--witness', s.store, ...extra])

describe('THE INSIDER REWRITE, through the CLI', () => {
  const s = setup()
  const cps = [2, 5, 8].map(n => sign(s, s.book, ['--length', String(n)]))

  it('the witness signs positions 2, 5 and 8, each linked to the last', () => {
    expect(cps.map(r => r.code)).toEqual([0, 0, 0])
    const [a, b, c] = cps.map(r => r.json())
    expect([a.checkpoint.body.length, b.checkpoint.body.length, c.checkpoint.body.length]).toEqual([2, 5, 8])
    expect(a.checkpoint.body.prev_checkpoint).toBeUndefined()
    expect(b.checkpoint.body.prev_checkpoint).toBe(a.checkpoint.checkpoint_id)
    expect(c.checkpoint.body.prev_checkpoint).toBe(b.checkpoint.checkpoint_id)
    expect(a.witness_keys).toEqual({ auditor: AUDITOR.pub })
    expect(a.published).toMatchObject({ appended: true, location: s.store })
    expect(readFileSync(s.store, 'utf8').trim().split('\n')).toHaveLength(3)
    expect(cps[1]!.err).toMatch(/signed position 5 .* as witness 'auditor', after .* \(position 2\)/)
  })

  it('the honest book holds every checkpoint: exit 0', () => {
    const r = check(s, s.book)
    expect(r.code).toBe(0)
    expect(r.json()).toMatchObject({ ok: true, content: true, verified_through: 10, anchored_through: 8, gaps: [] })
    expect(r.json().checkpoints.map((c: any) => c.status)).toEqual(['held', 'held', 'held'])
    expect(r.err).toMatch(/HELD: the book's first 8 event\(s\) are the anchored history \(3 checkpoint\(s\) held, payloads re-hashed\); events 8…9 are not anchored yet/)
  })

  it('the forged file verifies internally, and exits 2 at the first anchored position after the change', () => {
    const forged = put(s.d, 'forged.jsonl', forgedChain())
    // Read back from disk, the forgery is flawless inside: every link, entry hash, payload hash and the content read.
    const f = parseChainJSONL(readFileSync(forged, 'utf8'))
    expect(verifyChain(f.events).ok).toBe(true)
    expect(verifyChainAgainst(f.events, ev => f.payloads[ev.seq]).ok).toBe(true)
    expect(readDecisionBook(f.events, f.payloads).ok).toBe(true)

    const r = check(s, forged)
    expect(r.code).toBe(2)
    const rep = r.json()
    expect(rep).toMatchObject({ ok: false, verified_through: 10, anchored_through: 2 })
    expect(rep.checkpoints.map((c: any) => c.status)).toEqual(['held', 'rewritten', 'rewritten'])
    expect(rep.first_failure).toMatchObject({ status: 'rewritten', length: 5, within: { from: 2, to: 4 } })
    expect(r.err).toMatch(/REWRITTEN at the checkpoint of position 5 \(.{12}…, witness 'auditor'\): the anchored prefix was rewritten: .*; the change lies in events 2…4\n/)
  })

  it('the witness refuses to extend the forged history: exit 2, the store byte-identical', () => {
    const forged = put(s.d, 'forged-2.jsonl', forgedChain())
    const before = bytes(s.store)
    const r = sign(s, forged)
    expect(r.code).toBe(2)
    expect(r.json()).toMatchObject({ signed: false, last_checkpoint: { length: 8 }, check: { status: 'rewritten', within: { from: 0, to: 7 } } })
    expect(r.err).toMatch(/REWRITTEN at position 8: the book no longer holds the history the witness store's last checkpoint .* anchored.*nothing was signed or written/)
    expect(bytes(s.store)).toBe(before)
  })

  it('a book truncated past a checkpoint: exit 2 on both verbs, the position named', () => {
    const lines = readFileSync(s.book, 'utf8').split('\n').filter(Boolean)
    const cut = put(s.d, 'cut.jsonl', lines.slice(0, 6).join('\n'))
    const r = check(s, cut)
    expect(r.code).toBe(2)
    expect(r.json().first_failure).toMatchObject({ status: 'truncated', length: 8 })
    expect(r.err).toMatch(/TRUNCATED at the checkpoint of position 8/)
    const before = bytes(s.store)
    const w = sign(s, cut)
    expect(w.code).toBe(2)
    expect(w.err).toMatch(/TRUNCATED at position 8/)
    expect(bytes(s.store)).toBe(before)
  })

  it('the book grows, and the witness extends: position 10 after 8', () => {
    const r = sign(s, s.book)
    expect(r.code).toBe(0)
    expect(r.json().checkpoint.body).toMatchObject({ length: 10, prev_checkpoint: cps[2]!.json().checkpoint.checkpoint_id })
    const again = sign(s, s.book)
    expect(again.code).toBe(0)
    expect(again.json().signed).toBe(false)
    expect(again.err).toMatch(/already anchored/)
    expect(readFileSync(s.store, 'utf8').trim().split('\n')).toHaveLength(4)
  })
})

describe('the witness store as a directory (one file per checkpoint, never overwritten)', () => {
  it('a path ending in a separator is a directory store; verify reads it back', () => {
    const s = setup()
    const dir = join(s.d, 'bucket') + sep
    const a = go(['anchor', 'checkpoint', '--ledger', s.book, '--key', s.key, '--signer', 'auditor', '--out', dir, '--length', '4', '--book-id', 'acme-ap'])
    const b = go(['anchor', 'checkpoint', '--ledger', s.book, '--key', s.key, '--signer', 'auditor', '--out', dir, '--book-id', 'acme-ap'])
    expect([a.code, b.code]).toEqual([0, 0])
    expect(readdirSync(dir).filter(f => f.endsWith('.json'))).toHaveLength(2)
    const r = go(['anchor', 'verify', '--ledger', s.book, '--witness', dir, '--trusted-keys', s.wk, '--book-id', 'acme-ap'])
    expect(r.code).toBe(0)
    expect(r.json()).toMatchObject({ ok: true, anchored_through: 10 })
    // Another book's name: nothing counts.
    const other = go(['anchor', 'verify', '--ledger', s.book, '--witness', dir, '--trusted-keys', s.wk, '--book-id', 'other'])
    expect(other.code).toBe(1)
    expect(other.err).toMatch(/REFUSED: no checkpoint in .* counts \(2 read\)/)
  })
})

describe('the registry route (--root-keys): only a key registered with the witness role signs', () => {
  it('a registered witness signs and is read by --root-keys; a key_admin-only key is refused, nothing written', () => {
    const s = setup()
    const root = put(s.d, 'root.pub.pem', ROOT.pub)
    const good = put(s.d, 'good.jsonl', makeBook({ witnessRoles: ['witness' as Role] }).chainJSONL())
    const r = sign(s, good, ['--root-keys', root])
    expect(r.code).toBe(0)
    expect(r.err).toMatch(/Readers anchor this witness by --root-keys/)
    const v = check(s, good, ['--root-keys', root])
    expect(v.code).toBe(0)
    expect(v.json().checkpoints[0]).toMatchObject({ status: 'held', via: 'registry' })

    const s2 = setup()
    const admin = put(s2.d, 'admin.jsonl', makeBook({ witnessRoles: ['key_admin' as Role] }).chainJSONL())
    const bookBefore = bytes(admin)
    const w = go(['anchor', 'checkpoint', '--ledger', admin, '--key', s2.key, '--signer', 'auditor', '--out', s2.store, '--root-keys', put(s2.d, 'root.pub.pem', ROOT.pub)])
    expect(w.code).toBe(1)
    expect(w.err).toMatch(/REFUSED: this checkpoint would not count under the key registry .*'witness' role/)
    expect(existsSync(s2.store)).toBe(false)
    expect(bytes(admin)).toBe(bookBefore)
  })
})

describe('refusals (exit 1) and usage (exit 3) leave every file byte-identical', () => {
  it('checkpoint: a public key, a position past the end, a broken book, an altered store line, a corrupt store', () => {
    const s = setup()
    const bookBefore = bytes(s.book)
    const pubKey = go(['anchor', 'checkpoint', '--ledger', s.book, '--key', s.pub, '--signer', 'auditor', '--out', s.store])
    expect(pubKey.code).toBe(1)
    expect(pubKey.err).toMatch(/--key must be the witness's Ed25519 PRIVATE key/)
    expect(existsSync(s.store)).toBe(false)

    const past = sign(s, s.book, ['--length', '11'])
    expect(past.code).toBe(1)
    expect(past.err).toMatch(/REFUSED: .*has not reached/)
    expect(existsSync(s.store)).toBe(false)

    const lines = readFileSync(s.book, 'utf8').split('\n')
    const ev = JSON.parse(lines[3]!)
    lines[3] = JSON.stringify({ ...ev, payload: JSON.parse(JSON.stringify(ev.payload).replaceAll('"FAIL"', '"PASS"')) })
    const brokenBook = put(s.d, 'broken.jsonl', lines.join('\n'))
    const b = sign(s, brokenBook)
    expect(b.code).toBe(1)
    expect(b.err).toMatch(/REFUSED: the book does not verify at position 3/)
    expect(existsSync(s.store)).toBe(false)

    expect(sign(s, s.book, ['--length', '5']).code).toBe(0)
    const good = bytes(s.store)!
    // An edit inside the anchored prefix, without recomputing: BROKEN at the store's checkpoint (exit 2).
    const onBroken = sign(s, brokenBook)
    expect(onBroken.code).toBe(2)
    expect(onBroken.err).toMatch(/BROKEN at position 5: .*inside the anchored prefix; the change lies in events 0…4\. A witness never extends/)
    expect(bytes(s.store)).toBe(good)

    writeFileSync(s.store, good.replace('"length":5', '"length":6'))
    const altered = bytes(s.store)
    const a = sign(s, s.book)
    expect(a.code).toBe(1)
    expect(a.err).toMatch(/REFUSED: 1 checkpoint\(s\) in .* do not verify/)
    expect(bytes(s.store)).toBe(altered)
    const va = check(s, s.book)
    expect(va.code).toBe(1)
    expect(va.err).toMatch(/note: the checkpoint of position 6 .* does not count \(refused\)/)

    writeFileSync(s.store, 'not json\n')
    const c = sign(s, s.book)
    expect(c.code).toBe(1)
    expect(c.err).toMatch(/REFUSED: .*witness\.jsonl:1: not a JSON checkpoint/)
    expect(check(s, s.book).code).toBe(1)
    expect(bytes(s.store)).toBe('not json\n')
    expect(bytes(s.book)).toBe(bookBefore)
  })

  it('verify: an unanchored witness counts for nothing (1); a break past the last checkpoint is the chain\'s own (1)', () => {
    const s = setup()
    expect(sign(s, s.book, ['--length', '5']).code).toBe(0)
    const stranger = put(s.d, 'stranger.json', JSON.stringify({ someone: OPS.pub }))
    const u = check(s, s.book, ['--trusted-keys', stranger])
    expect(u.code).toBe(1)
    expect(u.err).toMatch(/witness 'auditor' is not anchored/)
    const wrong = put(s.d, 'wrong.json', JSON.stringify({ auditor: OPS.pub }))
    expect(check(s, s.book, ['--trusted-keys', wrong]).code).toBe(1)

    const lines = readFileSync(s.book, 'utf8').split('\n')
    const ev = JSON.parse(lines[8]!)
    lines[8] = JSON.stringify({ ...ev, payload: JSON.parse(JSON.stringify(ev.payload).replaceAll('"PASS"', '"FAIL"')) })
    const tail = put(s.d, 'tail.jsonl', lines.join('\n'))
    const t = check(s, tail)
    expect(t.code).toBe(1)
    expect(t.json()).toMatchObject({ ok: false, anchored_through: 5, verified_through: 8 })
    expect(t.err).toMatch(/REFUSED: the book does not verify internally at position 8, past its last anchored position \(5\)/)
  })

  it('usage: 3', () => {
    const s = setup()
    expect(go(['anchor']).code).toBe(3)
    expect(go(['anchor', 'stamp']).code).toBe(3)
    expect(go(['anchor', 'checkpoint', '--ledger', s.book, '--key', s.key, '--signer', 'auditor']).err).toMatch(/needs --out/)
    expect(sign(s, s.book, ['--length', '0']).code).toBe(3)
    expect(sign(s, s.book, ['--trusted-keys', s.wk]).code).toBe(3)
    const noAnchor = go(['anchor', 'verify', '--ledger', s.book, '--witness', s.store])
    expect(noAnchor.code).toBe(3)
    expect(noAnchor.err).toMatch(/needs --trusted-keys .* or --root-keys/)
    expect(check(s, s.book).code).toBe(3) // no witness store at the path: never read as "nothing anchored"
    expect(existsSync(s.store)).toBe(false)
  })
})
