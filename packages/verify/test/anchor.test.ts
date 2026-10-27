/**
 * External anchoring (2026-09-28): signed checkpoints of the chain head, and the attack they exist for.
 *   - THE INSIDER REWRITE: an old verdict is changed and the whole chain recomputed, so the book verifies internally; checked
 *     against independently held checkpoints it fails at the first anchored position the rewrite touches.
 *   - FORGED CHECKPOINTS are refused (wrong key, unanchored witness, altered body, a key_admin key without the witness role).
 *   - A checkpoint past the book's end is refused; a book truncated past a checkpoint is reported.
 *   - THE WITNESS STORE: append-only, idempotent, never forked; a deleted checkpoint shows as a gap.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { createPrivateKey, createPublicKey } from 'node:crypto'
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verify, type Verdict } from '../src/index'
import {
  createLedger, verifyChain, verifyChainAgainst, readDecisionBook, signDecision, makeKeyRegister, ROLES,
  type ChainSnapshot, type Role,
} from '../src/ledger/index'
import {
  checkpoint, verifyCheckpoint, verifyAgainstCheckpoints, verifyCheckpointSignature, signCheckpoint, CheckpointRefused,
  fileWitness, dirWitness, readWitnessFile, readWitnessDir, CHECKPOINT_VERSION, type Checkpoint, type WitnessAnchors,
} from '../src/anchor/index'
import { canonicalize } from '../src/verdict/canonical'
import { clean, broken, FIXED_NOW } from './fixtures/invoices'

function keyFromSeed(seedHex: string): { priv: string; pub: string } {
  const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(seedHex, 'hex')])
  const k = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })
  return { priv: k.export({ type: 'pkcs8', format: 'pem' }).toString(), pub: createPublicKey(k).export({ type: 'spki', format: 'pem' }).toString() }
}
const ROOT = keyFromSeed('a1'.repeat(32))
const OWNER = keyFromSeed('11'.repeat(32))
const AUDITOR = keyFromSeed('77'.repeat(32))
const INSIDER = keyFromSeed('88'.repeat(32))
const ANCHORS: WitnessAnchors = { witness_keys: { auditor: AUDITOR.pub } }

const VERDICTS: Verdict[] = Array.from({ length: 10 }, (_, i) =>
  verify({ ...(i % 3 === 0 ? broken : clean), invoice_number: `AN-${i}` }, { now: FIXED_NOW }))

function makeBook(opts: { verdicts?: Verdict[]; root?: boolean; before?: (l: ReturnType<typeof createLedger>, iso: () => string) => void } = {}) {
  let clock = Date.parse('2026-09-01T09:00:00.000Z')
  const tick = (): Date => new Date((clock += 60_000))
  const ledger = createLedger({ now: tick, ...(opts.root ? { root_keys: [ROOT.pub] } : {}) })
  opts.before?.(ledger, () => new Date(clock).toISOString())
  for (const v of opts.verdicts ?? VERDICTS) ledger.record(v, { tenant_id: 'acme' })
  return ledger
}

/**
 * The insider: re-record the whole history through the engine itself, with verdict 3 (a FAIL: a held payment) swapped for a
 * coherent PASS of the same invoice number. Every hash is recomputed and every verdict is well-formed, so the forged book
 * passes every internal check the ledger has.
 */
function forgedBook(): ChainSnapshot {
  const swapped = VERDICTS.map((v, i) => (i === 3 ? verify({ ...clean, invoice_number: 'AN-3' }, { now: FIXED_NOW }) : v))
  return makeBook({ verdicts: swapped }).snapshot()
}
const flipFailToPass = (p: unknown): unknown => {
  const s = JSON.stringify(p)
  const t = s.replaceAll('"FAIL"', '"PASS"')
  expect(t).not.toBe(s)
  return JSON.parse(t)
}

const dirs: string[] = []
const tmp = (): string => { const d = mkdtempSync(join(tmpdir(), 'riposte-anchor-')); dirs.push(d); return d }
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })

describe('checkpoint: a signed, canonical statement of the chain head', () => {
  it('is deterministic, verifies on its own, and anchors the chain\'s own clock', () => {
    const a = checkpoint(makeBook(), { key: AUDITOR.priv, witness_id: 'auditor', length: 5 })
    const b = checkpoint(makeBook(), { key: AUDITOR.priv, witness_id: 'auditor', length: 5 })
    expect(canonicalize(a)).toBe(canonicalize(b))
    expect(a.body.checkpoint_version).toBe(CHECKPOINT_VERSION)
    expect(verifyCheckpointSignature(a)).toEqual({ ok: true })
    const book = makeBook()
    expect(a.body.head).toBe(book.events()[4]!.entry_hash)
    expect(a.body.as_of).toBe(book.events()[4]!.ts)
    expect(verifyCheckpoint(a, book, ANCHORS)).toMatchObject({ status: 'held', ok: true, via: 'witness_keys' })
  })

  it('refuses a position the book has not reached, and an empty book', () => {
    const book = makeBook()
    expect(() => checkpoint(book, { key: AUDITOR.priv, witness_id: 'auditor', length: 11 })).toThrow(/has not reached/)
    expect(() => checkpoint(createLedger(), { key: AUDITOR.priv, witness_id: 'auditor' })).toThrow(CheckpointRefused)
  })

  it('never signs over a broken book', () => {
    const snap = makeBook().snapshot()
    const payloads = snap.payloads.slice()
    payloads[3] = flipFailToPass(payloads[3])
    expect(() => checkpoint({ events: snap.events, payloads }, { key: AUDITOR.priv, witness_id: 'auditor' })).toThrow(/does not verify at position 3/)
  })
})

describe('THE INSIDER REWRITE: recomputed chains verify internally, and fail against the checkpoints', () => {
  const book = makeBook()
  const witnessFile = join(tmp(), 'witness.jsonl')
  const w = fileWitness(witnessFile)
  const c2 = checkpoint(book, { key: AUDITOR.priv, witness_id: 'auditor', length: 2 })
  const c5 = checkpoint(book, { key: AUDITOR.priv, witness_id: 'auditor', length: 5, prev: c2 })
  const c8 = checkpoint(book, { key: AUDITOR.priv, witness_id: 'auditor', length: 8, prev: c5 })
  for (const c of [c2, c5, c8]) w.publish(c)
  const held = readWitnessFile(witnessFile)

  it('the honest book holds every checkpoint', () => {
    const r = verifyAgainstCheckpoints(book, held, ANCHORS)
    expect(r).toMatchObject({ ok: true, content: true, verified_through: 10, anchored_through: 8, gaps: [] })
    expect(r.checkpoints.map(c => c.status)).toEqual(['held', 'held', 'held'])
  })

  it('the rewrite of verdict 3 (FAIL → PASS, chain recomputed) is caught at the first anchored position after it', () => {
    const forged = forgedBook()
    // Internally, the forgery is flawless: every link, entry hash and payload hash recomputes.
    expect(verifyChain(forged.events).ok).toBe(true)
    expect(verifyChainAgainst(forged.events, ev => forged.payloads[ev.seq]).ok).toBe(true)
    expect(readDecisionBook(forged.events, forged.payloads).ok).toBe(true) // the full content read (headers, verdict door) passes it too // the full content read (headers held to payloads) passes it too
    expect(forged.events[9]!.entry_hash).not.toBe(book.chainHead())

    const r = verifyAgainstCheckpoints(forged, held, ANCHORS)
    expect(r.ok).toBe(false)
    expect(r.verified_through).toBe(10)
    expect(r.anchored_through).toBe(2)
    expect(r.checkpoints.map(c => c.status)).toEqual(['held', 'rewritten', 'rewritten'])
    expect(r.first_failure).toMatchObject({ status: 'rewritten', length: 5, within: { from: 2, to: 4 }, checkpoint_id: c5.checkpoint_id })
    expect(r.first_failure!.reason).toMatch(/verify internally but hash to/)
  })

  it('structure alone (no payloads) still catches it', () => {
    const forged = forgedBook()
    const r = verifyAgainstCheckpoints({ events: forged.events }, held, ANCHORS)
    expect(r).toMatchObject({ ok: false, content: false, anchored_through: 2 })
    expect(r.first_failure?.length).toBe(5)
  })

  it('an edit WITHOUT recomputing is a break inside the anchored prefix', () => {
    const snap = book.snapshot()
    const payloads = snap.payloads.slice()
    payloads[6] = flipFailToPass(payloads[6])
    const r = verifyAgainstCheckpoints({ events: snap.events, payloads }, held, ANCHORS)
    expect(r.verified_through).toBe(6)
    expect(r.checkpoints.map(c => c.status)).toEqual(['held', 'held', 'broken'])
    expect(r.first_failure).toMatchObject({ status: 'broken', length: 8, within: { from: 5, to: 7 } })
  })

  it('re-timed event headers (outside entry_hash) move the anchored clock', () => {
    const snap = book.snapshot()
    const events = snap.events.map(e => ({ ...e }))
    events[1]!.ts = '2026-09-30T00:00:00.000Z'
    expect(verifyChain(events).ok).toBe(true)
    const r = verifyAgainstCheckpoints({ events, payloads: snap.payloads }, held, ANCHORS)
    expect(r.checkpoints.map(c => c.status)).toEqual(['rewritten', 'rewritten', 'rewritten'])
    expect(r.first_failure!.reason).toMatch(/timestamps before position 2 were altered/)
  })

  it('a book truncated past a checkpoint is reported', () => {
    const snap = book.snapshot()
    const r = verifyAgainstCheckpoints({ events: snap.events.slice(0, 6), payloads: snap.payloads.slice(0, 6) }, held, ANCHORS)
    expect(r.checkpoints.map(c => c.status)).toEqual(['held', 'held', 'truncated'])
    expect(r.first_failure!.reason).toMatch(/held 8 events; this one holds 6/)
    expect(r.ok).toBe(false)
  })

  it('a witness never extends a rewritten history', () => {
    const forged = forgedBook()
    expect(() => checkpoint(forged, { key: AUDITOR.priv, witness_id: 'auditor', prev: c5 })).toThrow(/no longer holds the history prev anchored/)
    expect(() => checkpoint(forged, { key: AUDITOR.priv, witness_id: 'auditor', prev: c2 })).not.toThrow()
  })
})

describe('FORGED checkpoints are refused, and cannot rescue a rewrite', () => {
  const book = makeBook()
  const forged = forgedBook()
  const honest = checkpoint(book, { key: AUDITOR.priv, witness_id: 'auditor', length: 5 })

  it('a checkpoint of the forged book signed by the insider as "auditor" is refused', () => {
    const fake = checkpoint(forged, { key: INSIDER.priv, witness_id: 'auditor', length: 5 })
    const r = verifyAgainstCheckpoints(forged, [fake, honest], ANCHORS)
    expect(r.checkpoints.find(c => c.checkpoint_id === fake.checkpoint_id)).toMatchObject({ status: 'refused', reason: expect.stringMatching(/not the one anchored to witness 'auditor'/) })
    expect(r.first_failure).toMatchObject({ status: 'rewritten', checkpoint_id: honest.checkpoint_id })
    expect(r.ok).toBe(false)
  })

  it('an unanchored witness, a body altered after signing, and no anchors at all are refused', () => {
    const stranger = checkpoint(book, { key: INSIDER.priv, witness_id: 'stranger', length: 5 })
    expect(verifyCheckpoint(stranger, book, ANCHORS)).toMatchObject({ status: 'refused', reason: expect.stringMatching(/witness 'stranger' is not anchored/) })
    const altered: Checkpoint = { ...honest, body: { ...honest.body, length: 4, head: book.events()[3]!.entry_hash } }
    expect(verifyCheckpoint(altered, book, ANCHORS)).toMatchObject({ status: 'refused', reason: expect.stringMatching(/does not derive from the body/) })
    const resigned = { ...altered, checkpoint_id: signCheckpoint(altered.body, INSIDER.priv).checkpoint_id }
    expect(verifyCheckpoint(resigned, book, ANCHORS)).toMatchObject({ status: 'refused', reason: expect.stringMatching(/signature does not verify/) })
    expect(verifyCheckpoint(honest, book, {})).toMatchObject({ status: 'refused' })
    expect(verifyCheckpoint({ nonsense: true }, book, ANCHORS)).toMatchObject({ status: 'refused' })
  })

  it('another book\'s checkpoint is refused when the book is named', () => {
    const named = checkpoint(book, { key: AUDITOR.priv, witness_id: 'auditor', length: 5, book_id: 'globex' })
    expect(verifyCheckpoint(named, book, ANCHORS, { book_id: 'acme' })).toMatchObject({ status: 'refused', reason: expect.stringMatching(/anchors book 'globex', not 'acme'/) })
    expect(verifyCheckpoint(named, book, ANCHORS, { book_id: 'globex' })).toMatchObject({ status: 'held' })
  })

  it('a key registered on the book as a key_admin is not a witness (segregation of duties)', () => {
    const rooted = makeBook({
      root: true,
      before: (l, iso) => l.decide(signDecision(makeKeyRegister({ subject_id: 'ops', public_key: OWNER.pub, roles: ['key_admin'], signer_id: 'root', signed_at: iso() }), ROOT.priv)),
    })
    const cp = checkpoint(rooted, { key: OWNER.priv, witness_id: 'ops' })
    expect(verifyCheckpoint(cp, rooted, { root_keys: [ROOT.pub] })).toMatchObject({ status: 'refused', reason: expect.stringMatching(/needs the 'witness' role/) })
  })

  it.skipIf(!(ROLES as readonly string[]).includes('witness'))('a key registered on the book with the witness role counts (registry patch)', () => {
    const rooted = makeBook({
      root: true,
      before: (l, iso) => l.decide(signDecision(makeKeyRegister({ subject_id: 'auditor', public_key: AUDITOR.pub, roles: ['witness' as Role], signer_id: 'root', signed_at: iso() }), ROOT.priv)),
    })
    const cp = checkpoint(rooted, { key: AUDITOR.priv, witness_id: 'auditor' })
    expect(verifyCheckpoint(cp, rooted, { root_keys: [ROOT.pub] })).toMatchObject({ status: 'held', via: 'registry' })
    // ... but not one that also keeps the registry.
    const both = makeBook({
      root: true,
      before: (l, iso) => l.decide(signDecision(makeKeyRegister({ subject_id: 'ops', public_key: OWNER.pub, roles: ['key_admin', 'witness' as Role], signer_id: 'root', signed_at: iso() }), ROOT.priv)),
    })
    expect(verifyCheckpoint(checkpoint(both, { key: OWNER.priv, witness_id: 'ops' }), both, { root_keys: [ROOT.pub] })).toMatchObject({ status: 'refused', reason: expect.stringMatching(/not an independent witness/) })
  })
})

describe('THE WITNESS STORE: append-only, never forked, gaps show', () => {
  const book = makeBook()
  const c2 = checkpoint(book, { key: AUDITOR.priv, witness_id: 'auditor', length: 2 })
  const c5 = checkpoint(book, { key: AUDITOR.priv, witness_id: 'auditor', length: 5, prev: c2 })
  const c8 = checkpoint(book, { key: AUDITOR.priv, witness_id: 'auditor', length: 8, prev: c5 })

  it('file: idempotent, refuses a fork and a forged line', () => {
    const path = join(tmp(), 'w.jsonl')
    const w = fileWitness(path)
    expect(w.publish(c2).appended).toBe(true)
    expect(w.publish(c2).appended).toBe(false)
    const orphan = checkpoint(book, { key: AUDITOR.priv, witness_id: 'auditor', length: 5 })
    expect(() => w.publish(orphan)).toThrow(/names it as prev_checkpoint/)
    expect(() => w.publish({ ...c5, signature: c2.signature })).toThrow(/not published/)
    w.publish(c5)
    expect(readFileSync(path, 'utf8').trim().split('\n')).toHaveLength(2)
  })

  it('a checkpoint deleted from the store shows as a gap', () => {
    const r = verifyAgainstCheckpoints(book, [c2, c8], ANCHORS)
    expect(r.ok).toBe(true)
    expect(r.gaps).toEqual([c5.checkpoint_id])
  })

  it('dir: one object per checkpoint, never overwritten', () => {
    const dir = join(tmp(), 'objects')
    const w = dirWitness(dir)
    for (const c of [c2, c5, c8]) expect(w.publish(c).appended).toBe(true)
    expect(w.publish(c5).appended).toBe(false)
    expect(readdirSync(dir)).toHaveLength(3)
    expect(verifyAgainstCheckpoints(book, readWitnessDir(dir), ANCHORS)).toMatchObject({ ok: true, anchored_through: 8, gaps: [] })
  })
})

describe('offline by construction', () => {
  it('src/anchor imports no network module and calls no fetch', () => {
    const dir = join(__dirname, '..', 'src', 'anchor')
    for (const f of readdirSync(dir).filter(f => f.endsWith('.ts'))) {
      const src = readFileSync(join(dir, f), 'utf8')
      expect(src, f).not.toMatch(/from ['"](node:)?(http|https|net|tls|dgram|dns)['"]/)
      expect(src, f).not.toMatch(/\bfetch\s*\(/)
    }
  })
})
