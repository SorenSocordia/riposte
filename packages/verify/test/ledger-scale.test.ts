/**
 * Ledger scale (2026-09-28): a book of record used to stop at ~40k verdicts (one-string export, one-string reopen, a full
 * re-hash on every read). These pin the replacements, and that every byte, head and verification result stays the same:
 *   -    ledger.snapshot() by reference (frozen, point-in-time); chainJSONL throws a NAMED error past its ceiling; the
 *        streaming writers produce chainJSONL's exact bytes.
 *   -    a streamed reopen reads exactly what parseChainJSONL reads (chunk boundaries, CRLF, BOM, blank lines, UTF-8).
 *   -    one held file descriptor: the same bytes as appendFileSync per event; close / dispose; read-only; fsync.
 *   -    the red team's torn-tail cases (redteam/r5-partial-line-bricks-book.redteam.ts), turned around: a torn LAST line
 *        opens read-only and is never silently dropped; repairTornTail backs up, truncates and records; a torn MIDDLE line
 *        is corruption.
 *   -    the verified prefix: a later check re-hashes only what was appended, and says so; full re-checks and reopens re-hash
 *        everything; the trust it adds (in-process memory) is pinned as a stated boundary, not hidden.
 *   -    the door's incremental indexes (decision list, key registry, sample keys) decide exactly as a fresh read of the book.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { createPrivateKey, createPublicKey } from 'node:crypto'
import { Writable } from 'node:stream'
import { mkdtempSync, readFileSync, writeFileSync, appendFileSync, existsSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verify, verifyAction, type Verdict } from '../src/index'
import {
  createLedger, MemoryLedger, openFileLedger, parseChainJSONL, readChainFile, repairTornTail, writeChainJSONL, writeChainFile, chainLines,
  readDecisionBook, registryOf, signDecision, makeGrant, makeKeyRegister, makeKeyRevoke, makeReview,
  ChainExportTooLarge, TornTailError, LedgerFileCorrupt, LedgerReadOnly, chainPeriods,
  type Ledger, type LedgerEvent, type SignedDecision, type BookDecision,
} from '../src/ledger/index'
import { openSnapshot } from '../src/opinion/index'
import { policyRef, type PromotionPolicy } from '../src/verdict/voice'
import { clean, broken, FIXED_NOW } from './fixtures/invoices'

const dir = mkdtempSync(join(tmpdir(), 'verify-ledger-scale-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
let n = 0
const tmpPath = (): string => join(dir, `book-${n++}.jsonl`)

let t = Date.parse('2026-09-28T00:00:00Z')
const tick = (): Date => new Date((t += 60_000))

const PASSES: Verdict[] = Array.from({ length: 40 }, (_, i) => verify({ ...clean, invoice_number: `LS-P${i}` }, { now: FIXED_NOW }))
const FAILS: Verdict[] = Array.from({ length: 10 }, (_, i) => verify({ ...broken, invoice_number: `LS-F${i}` }, { now: FIXED_NOW }))

/** A small real book: records by two tenants, reviews (one with a non-ASCII note), a re-record. */
function book(led: Ledger = createLedger({ now: tick }), count = 12): Ledger {
  for (let i = 0; i < count; i++) {
    const v = i % 4 === 3 ? FAILS[i % FAILS.length]! : PASSES[i]!
    led.record(v, { tenant_id: i % 3 === 0 ? 'globex' : 'acme' })
    if (i % 3 === 1) led.review(v.verdict_id, { reviewer_id: 'rev', decision: i % 2 ? 'UPHELD' : 'OVERTURNED', note: 'geprüft ✓ 確認済み' })
  }
  led.record(PASSES[1]!, { tenant_id: 'acme' }) // a re-record keeps its review
  return led
}

const legacyExport = (led: Ledger): string => { const s = led.snapshot(); return s.events.map((e, i) => JSON.stringify({ ...e, payload: s.payloads[i] })).join('\n') }

describe('the chain by reference, and exports that never build one string', () => {
  it('snapshot() is the parsed export, with no string in between; point-in-time; the caller\'s copy, the ledger\'s frozen events', () => {
    const led = book()
    const snap = led.snapshot()
    expect(snap).toEqual(parseChainJSONL(led.chainJSONL()))
    expect(Object.isFrozen(snap.events[0])).toBe(true)
    expect(() => { (snap.events[0] as { payload_hash: string }).payload_hash = '0'.repeat(64) }).toThrow(TypeError)
    const len = snap.events.length
    const head = led.chainHead()
    snap.events.pop(); snap.payloads.pop(); snap.events[0] = { ...snap.events[0]!, verdict_id: 'edited' } // the caller's copy
    expect(led.events()).toHaveLength(len)
    expect(led.chainHead()).toBe(head)
    expect(led.verifyContent({ full: true }).ok).toBe(true) // the book never saw it
    led.record(PASSES[30]!, { tenant_id: 'acme' })
    expect(led.snapshot().events).toHaveLength(len + 1)
    expect(snap.events).toHaveLength(len - 1) // a snapshot does not grow
  })

  it('a reader of the snapshot reads exactly what the ledger reads', () => {
    const led = book()
    const own = led.decisionBook()
    const read = readDecisionBook(led.snapshot().events, led.snapshot().payloads)
    expect(read.ok).toBe(true)
    expect({ ...read, check: undefined }).toEqual({ ...own, check: undefined })
    expect(openSnapshot(led.snapshot()).records).toEqual(led.all())
  })

  it('chainJSONL(): the same bytes as ever, and a NAMED error past its ceiling that points at the streaming paths', () => {
    const led = book()
    const text = led.chainJSONL()
    expect(text).toBe(legacyExport(led))
    expect(text.endsWith('\n')).toBe(false)
    let err: unknown
    try { led.chainJSONL({ maxChars: 2_000 }) } catch (e) { err = e }
    expect(err).toBeInstanceOf(ChainExportTooLarge)
    expect((err as Error).name).toBe('ChainExportTooLarge')
    expect((err as Error).message).toMatch(/writeChainJSONL\(ledger, stream\).*writeChainFile\(ledger, path\).*ledger\.snapshot\(\)/)
    expect((err as ChainExportTooLarge).events).toBe(led.snapshot().events.length)
    expect(led.chainJSONL({ maxChars: text.length })).toBe(text) // exactly at the cap still fits
    expect(() => led.chainJSONL({ maxChars: text.length - 1 })).toThrow(ChainExportTooLarge)
  })

  it('writeChainJSONL (a stream, with backpressure) and writeChainFile write exactly chainJSONL\'s bytes', async () => {
    const led = book()
    const want = Buffer.from(led.chainJSONL(), 'utf8')
    const chunks: Buffer[] = []
    let drains = 0
    const out = new Writable({ highWaterMark: 16, write(chunk, _enc, cb) { chunks.push(Buffer.from(chunk)); setImmediate(cb) } })
    out.on('drain', () => drains++)
    const r = await writeChainJSONL(led, out)
    expect(Buffer.concat(chunks).equals(want)).toBe(true)
    expect(r).toEqual({ events: led.snapshot().events.length, bytes: want.length })
    expect(drains).toBeGreaterThan(0)
    const p = tmpPath()
    expect(writeChainFile(led, p)).toEqual(r)
    expect(readFileSync(p).equals(want)).toBe(true)
    expect(() => writeChainFile(led, p)).toThrow(/EEXIST/) // never over a book
    led.record(PASSES[31]!, { tenant_id: 'acme' })
    writeChainFile(led.snapshot(), p, { flag: 'w' })
    expect(readFileSync(p, 'utf8')).toBe(led.chainJSONL())
    expect([...chainLines(led)]).toEqual(led.chainJSONL().split('\n'))
  })
})

describe('the streamed reopen reads exactly what parseChainJSONL reads', () => {
  const variants: [string, (s: string) => string][] = [
    ['a file ledger (every line ends in a newline)', s => s + '\n'],
    ['a chain export (no final newline)', s => s],
    ['CRLF line endings', s => s.replace(/\n/g, '\r\n') + '\r\n'],
    ['blank lines between events', s => '\n' + s.replace(/\n/g, '\n\n  \n') + '\n\n'],
    ['a byte-order mark', s => '\uFEFF' + s + '\n'],
  ]
  for (const [name, shape] of variants) {
    it(name, () => {
      const led = book()
      const p = tmpPath()
      const text = shape(led.chainJSONL())
      writeFileSync(p, text)
      const want = parseChainJSONL(text)
      for (const chunkBytes of [1, 7, 64, 4096, 8 * 1024 * 1024]) {
        const got = readChainFile(p, { chunkBytes })
        expect({ events: got.events, payloads: got.payloads }).toEqual(want)
        expect(got.torn).toBeUndefined()
      }
      const reopened = openFileLedger(p)
      expect(reopened.chainHead()).toBe(led.chainHead())
      expect(reopened.all()).toEqual(led.all())
      expect(reopened.verifyContent().ok).toBe(true)
    })
  }
})

describe('one held file descriptor, the same bytes', () => {
  it('appends write what appendFileSync per event wrote: each event line + newline; reopen continues the chain', () => {
    const p = tmpPath()
    const led = book(openFileLedger(p, { now: tick }))
    expect(readFileSync(p, 'utf8')).toBe(led.chainJSONL() + '\n')
    const again = openFileLedger(p, { now: tick })
    again.record(PASSES[20]!, { tenant_id: 'acme' })
    expect(readFileSync(p, 'utf8')).toBe(again.chainJSONL() + '\n')
    expect(openFileLedger(p).verifyContent().ok).toBe(true)
  })

  it('close() releases the handle and a later append opens it again; dispose closes; fsync writes the same bytes', () => {
    const p = tmpPath()
    const led = openFileLedger(p, { now: tick, fsync: true })
    led.record(PASSES[0]!, { tenant_id: 'acme' })
    led.close()
    led.close() // idempotent
    led.record(PASSES[1]!, { tenant_id: 'acme' })
    led[Symbol.dispose]()
    expect(readFileSync(p, 'utf8')).toBe(led.chainJSONL() + '\n')
    expect(openFileLedger(p).verifyContent().ok).toBe(true)
  })

  it('readOnly: nothing is ever written or created; an append throws LedgerReadOnly and changes nothing', () => {
    const missing = join(dir, 'never', 'created.jsonl')
    const ro = openFileLedger(missing, { readOnly: true })
    expect(() => ro.record(PASSES[0]!, { tenant_id: 'acme' })).toThrow(LedgerReadOnly)
    expect(existsSync(join(dir, 'never'))).toBe(false)
    const p = tmpPath()
    const led = book(openFileLedger(p, { now: tick }))
    const before = readFileSync(p)
    const view = openFileLedger(p, { readOnly: true })
    expect(view.readOnly).toBe(true)
    expect(() => view.record(PASSES[5]!, { tenant_id: 'acme' })).toThrow(LedgerReadOnly)
    expect(view.events()).toHaveLength(led.events().length) // memory did not run ahead of the file
    expect(readFileSync(p).equals(before)).toBe(true)
  })

  it('a store that fails appends nothing: memory never runs ahead of the file', () => {
    let fail = false
    const led = new MemoryLedger({ now: tick, onAppend: () => { if (fail) throw new Error('disk full') } })
    led.record(PASSES[0]!, { tenant_id: 'acme' })
    const head = led.chainHead()
    fail = true
    expect(() => led.record(PASSES[1]!, { tenant_id: 'acme' })).toThrow('disk full')
    expect(() => led.review(PASSES[0]!.verdict_id, { reviewer_id: 'r', decision: 'UPHELD' })).toThrow('disk full')
    expect(led.chainHead()).toBe(head)
    expect(led.get(PASSES[1]!.verdict_id)).toBeUndefined()
    expect(led.get(PASSES[0]!.verdict_id)?.review).toBeUndefined()
    fail = false
    led.record(PASSES[1]!, { tenant_id: 'acme' })
    expect(led.verifyContent().ok).toBe(true)
  })
})

describe('a torn tail never bricks the book (red team cases, turned around)', () => {
  /** The PoC's book: two real events written by the file ledger itself. */
  function goodBook(path: string): string {
    const led = openFileLedger(path, { now: () => new Date('2026-09-28T00:00:00Z') })
    led.record(verifyAction({ tool: 't', arguments: { amount: 1 } }, { allowed: { amount: [1] } }), { tenant_id: 't1' })
    led.record(verifyAction({ tool: 't', arguments: { amount: 2 } }, { allowed: { amount: [2] } }), { tenant_id: 't1' })
    led.close()
    return readFileSync(path, 'utf8')
  }
  const TORN = '{"seq":2,"ts":"2026-09-28T00:00:00Z","type":"RECORD","verdict_id":"abc","payload_hash":"'

  it('HELD (unchanged): a clean file-backed book reopens and verifies', () => {
    const p = tmpPath()
    goodBook(p)
    const re = openFileLedger(p)
    expect(re.verifyContent().ok).toBe(true)
    expect(re.all()).toHaveLength(2)
    expect(re.torn).toBeUndefined()
  })

  it('FIXED: a torn last line opens READ-ONLY; every whole event reads and verifies; nothing is dropped; an append names the fix', () => {
    const p = tmpPath()
    const good = goodBook(p)
    appendFileSync(p, TORN)
    const bytes = readFileSync(p)
    const re = openFileLedger(p) // used to throw: the whole book was unopenable
    expect(re.torn).toMatchObject({ offset: Buffer.byteLength(good), bytes: Buffer.byteLength(TORN), line: 3, last_good_seq: 1 })
    expect(re.readOnly).toBe(true)
    expect(re.all()).toHaveLength(2)
    expect(re.verifyContent().ok).toBe(true)
    let err: unknown
    try { re.record(verifyAction({ tool: 't', arguments: { amount: 3 } }, { allowed: { amount: [3] } }), { tenant_id: 't1' }) } catch (e) { err = e }
    expect(err).toBeInstanceOf(TornTailError)
    expect((err as Error).name).toBe('TornTailError')
    expect((err as Error).message).toMatch(/torn line \(line 3, \d+ bytes at byte \d+, after event seq 1\).*Nothing was dropped.*READ-ONLY.*repairTornTail/)
    expect(re.events()).toHaveLength(2)
    expect(readFileSync(p).equals(bytes)).toBe(true) // never silently dropped: the torn bytes stay until a person repairs
    expect(() => readChainFile(p)).toThrow(TornTailError) // a plain read says so too
    expect(readChainFile(p, { allowTornTail: true }).events).toHaveLength(2)
  })

  it('repairTornTail backs up, truncates to the last whole line, records what it removed; then the book appends and verifies', () => {
    const p = tmpPath()
    const good = goodBook(p)
    appendFileSync(p, TORN)
    const original = readFileSync(p)
    const r = repairTornTail(p, { now: () => new Date('2026-09-28T12:00:00Z') })
    expect(r).toMatchObject({ repaired: true, truncated_to_bytes: Buffer.byteLength(good), events_kept: 2, last_good_seq: 1 })
    expect(readFileSync(r.backup!).equals(original)).toBe(true)
    expect(readFileSync(p, 'utf8')).toBe(good)
    expect(Buffer.from(r.removed!.base64, 'base64').toString('utf8')).toBe(TORN)
    const logged = readFileSync(r.log!, 'utf8').trim().split('\n').map(l => JSON.parse(l))
    expect(logged).toEqual([r])
    const led = openFileLedger(p, { now: tick })
    expect(led.readOnly).toBe(false)
    led.record(verifyAction({ tool: 't', arguments: { amount: 3 } }, { allowed: { amount: [3] } }), { tenant_id: 't1' })
    expect(openFileLedger(p).verifyContent().ok).toBe(true)
    expect(repairTornTail(p)).toMatchObject({ repaired: false }) // a whole book is left alone
  })

  it('a power-loss tail (NUL bytes) is torn too; a legitimate export whose last line lacks its newline is not', () => {
    const p = tmpPath()
    goodBook(p)
    appendFileSync(p, Buffer.alloc(300))
    expect(openFileLedger(p).torn).toBeDefined()
    const q = tmpPath()
    const src = book()
    writeFileSync(q, src.chainJSONL())
    const led = openFileLedger(q, { now: tick })
    expect(led.torn).toBeUndefined()
    led.record(PASSES[25]!, { tenant_id: 'acme' }) // the missing newline is written first
    expect(openFileLedger(q).verifyContent().ok).toBe(true)
  })

  it('a torn line in the MIDDLE is corruption: the book does not open, and repair refuses to touch it', () => {
    const p = tmpPath()
    const good = goodBook(p)
    const [a, b] = good.trim().split('\n')
    writeFileSync(p, `${a}\n${TORN}\n${b}\n`)
    const bytes = readFileSync(p)
    expect(() => openFileLedger(p)).toThrow(LedgerFileCorrupt)
    expect(() => openFileLedger(p)).toThrow(/line 2 .* does not parse .*not a torn last line/)
    expect(() => repairTornTail(p)).toThrow(LedgerFileCorrupt)
    expect(readFileSync(p).equals(bytes)).toBe(true)
    expect(readdirSync(dir).some(f => f.startsWith(p.split(/[\\/]/).pop()!) && f.endsWith('.bak'))).toBe(false)
  })
})

describe('a later check re-hashes only what was appended, and says so', () => {
  it('reused covers the verified prefix; an unchanged book re-hashes nothing; full re-hashes all; a reopen re-hashes all', () => {
    const p = tmpPath()
    const led = book(openFileLedger(p, { now: tick }))
    const first = led.verifyContent()
    expect(first.ok).toBe(true)
    expect(first.reused).toBeUndefined() // the first check of a book is always full
    const len = first.length
    led.record(PASSES[32]!, { tenant_id: 'acme' })
    led.review(PASSES[32]!.verdict_id, { reviewer_id: 'rev', decision: 'UPHELD' })
    const second = led.verifyContent()
    expect(second).toMatchObject({ ok: true, length: len + 2, head: led.chainHead(), reused: { through: len } })
    expect(Date.parse(second.reused!.verified_at)).not.toBeNaN()
    expect(led.verifyContent().reused?.through).toBe(len + 2) // unchanged: nothing re-hashed
    expect(led.verifyContent({ full: true }).reused).toBeUndefined()
    expect(led.decisionBook({ full: true }).check.reused).toBeUndefined()
    expect(openFileLedger(p).verifyContent().reused).toBeUndefined() // never carried across a reopen
  })

  // The alterations below are self-consistent (issued_at), so only the payload hash can catch them: the read side's verdict
  // door re-checks every RECORD's claims and outcome whenever the book is read.
  it('a payload appended AFTER the verified prefix and then altered in memory is caught by the incremental check', () => {
    const led = book()
    expect(led.verifyContent().ok).toBe(true)
    const rec = led.record(PASSES[33]!, { tenant_id: 'acme' })
    rec.verdict.issued_at = '2020-01-01T00:00:00.000Z' // the record shares its verdict with the event's payload
    const check = led.verifyContent()
    expect(check).toMatchObject({ ok: false, brokenAt: check.length - 1 })
    expect(check.reason).toMatch(/payload at \d+ was altered/)
  })

  it('THE STATED BOUNDARY: a verified payload altered IN PLACE is not seen by the incremental check; a full check sees it', () => {
    const led = book()
    const rec = led.get(PASSES[0]!.verdict_id)!
    expect(led.verifyContent().ok).toBe(true)
    rec.verdict.issued_at = '2020-01-01T00:00:00.000Z'
    expect(led.verifyContent().ok).toBe(true) // trusted: this process's own memory, verified at `reused.verified_at`
    led.record(PASSES[35]!, { tenant_id: 'acme' })
    expect(led.verifyContent()).toMatchObject({ ok: true, reused: { through: led.events().length - 1 } }) // still: only the new event is re-hashed
    expect(led.verifyContent({ full: true })).toMatchObject({ ok: false, brokenAt: 0 })
  })

  it('a snapshot carries the verified prefix; handed other payload objects, a reader re-hashes and catches the change', () => {
    const led = book()
    led.verifyContent()
    led.record(PASSES[34]!, { tenant_id: 'acme' })
    const snap = led.snapshot()
    const read = readDecisionBook(snap.events, snap.payloads)
    expect(read.ok).toBe(true)
    expect(read.check.reused?.through).toBe(snap.events.length - 1)
    const forged = structuredClone(snap.payloads) as { verdict?: { issued_at?: string } }[]
    forged[0]!.verdict!.issued_at = '2020-01-01T00:00:00.000Z'
    const other = readDecisionBook(snap.events, forged)
    expect(other).toMatchObject({ ok: false, check: { brokenAt: 0 } })
    expect(other.check.reused).toBeUndefined()
    // an edited copy (an event replaced at a verified position) is re-hashed in full, and the edit is caught
    const edited = led.snapshot()
    edited.events[1] = { ...edited.events[1]!, payload_hash: edited.events[2]!.payload_hash }
    const e = readDecisionBook(edited.events, edited.payloads)
    expect(e).toMatchObject({ ok: false, check: { brokenAt: 1 } })
    expect(e.check.reused).toBeUndefined()
    const parsed = parseChainJSONL(led.chainJSONL()) // a chain from outside the process never carries one
    expect(readDecisionBook(parsed.events, parsed.payloads).check.reused).toBeUndefined()
  })
})

// ── the incremental indexes need keys, a policy and a clock that crosses days ─────────────────────────────────────────────────────────
function keyFromSeed(seedHex: string): { priv: string; pub: string } {
  const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(seedHex, 'hex')])
  const k = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })
  return { priv: k.export({ type: 'pkcs8', format: 'pem' }).toString(), pub: createPublicKey(k).export({ type: 'spki', format: 'pem' }).toString() }
}
const ROOT = keyFromSeed('a1'.repeat(32))
const OWNER = keyFromSeed('11'.repeat(32))
const LEAD = keyFromSeed('22'.repeat(32))
const POLICY: PromotionPolicy = {
  policy_version: 'promotion-policy-v0', policy_id: 'scale', version: '1.0.0', method: 'wilson', sidedness: 'one-sided',
  tiers: [{ tier: 'low', description: 'test tier', confidence: 0.9, advise: { min_n: 3, max_error: 0.5 }, gate: { min_n: 5, max_error: 0.4 }, autonomy: { min_n: 8, max_error: 0.3 } }],
}
const WF = `acme/${PASSES[0]!.ruleset.id}@${PASSES[0]!.ruleset.version}`

describe('the door\'s incremental indexes decide exactly as a fresh read of the book', () => {
  it('differential: at every step, the live ledger and a ledger reopened from its snapshot accept and refuse the same', () => {
    let c = Date.parse('2026-09-01T09:00:00Z')
    const clock = (): Date => new Date((c += 3_600_000))
    const iso = (): string => new Date(c).toISOString()
    const live = createLedger({ now: clock, root_keys: [ROOT.pub] })
    const reopen = (): MemoryLedger => { const s = live.snapshot(); return new MemoryLedger({ now: clock, root_keys: [ROOT.pub], seed: { events: [...s.events], payloads: [...s.payloads] } }) }
    const both = <T>(act: (l: Ledger) => T): 'ok' | string => {
      const fresh = reopen()
      const outcome = (l: Ledger): string => { try { act(l); return 'ok' } catch (e) { return `${(e as Error).name}: ${(e as Error).message}` } }
      const want = outcome(fresh) // the fresh ledger decides first (on a copy), then the live one must agree
      const got = outcome(live)
      expect(got).toBe(want)
      return got
    }
    const reg = (key: { pub: string }, subject: string, roles: ('key_admin' | 'reviewer' | 'grant_signer' | 'policy_author')[]): SignedDecision<BookDecision> =>
      signDecision(makeKeyRegister({ subject_id: subject, public_key: key.pub, roles, signer_id: 'root', signed_at: iso() }), ROOT.priv) as SignedDecision<BookDecision>
    const grantOf = (level: 'advise' | 'gate', key = OWNER): SignedDecision<BookDecision> => signDecision(makeGrant({
      workflow_id: WF, level, consequence_tier: 'low', policy: policyRef(POLICY), signer_id: 'owner', signed_at: iso(),
    }), key.priv) as SignedDecision<BookDecision>
    const review = (id: string, key = LEAD) => signDecision(makeReview({ verdict_id: id, decision: 'UPHELD', signer_id: 'ap-lead', signed_at: iso(), procedure: 're-performed' }), key.priv)

    for (let i = 0; i < 6; i++) live.record(PASSES[i]!, { tenant_id: 'acme' })
    const ownerKey = reg(OWNER, 'owner', ['grant_signer', 'key_admin'])
    const leadKey = reg(LEAD, 'ap-lead', ['reviewer'])
    expect(both(l => l.decide(ownerKey))).toBe('ok')
    expect(both(l => l.decide(leadKey))).toBe('ok')
    expect(both(l => l.decide(leadKey))).toMatch(/already registered/)
    const r0 = review(PASSES[0]!.verdict_id)
    expect(both(l => l.reviewSigned(r0))).toBe('ok')
    const advise = grantOf('advise')
    expect(both(l => l.decide(advise))).toBe('ok')
    const byReviewer = grantOf('gate', LEAD)
    expect(both(l => l.decide(byReviewer))).toMatch(/DecisionRefused: .*registered to 'ap-lead', not 'owner'/) // a reviewer's key cannot grant
    const revoke = signDecision(makeKeyRevoke({ subject_id: 'ap-lead', public_key: LEAD.pub, reason: 'rotated', signer_id: 'root', signed_at: iso() }), ROOT.priv) as SignedDecision<BookDecision>
    expect(both(l => l.decide(revoke))).toBe('ok')
    const r1 = review(PASSES[1]!.verdict_id)
    expect(both(l => l.reviewSigned(r1))).toMatch(/revoked/)
    // a sample of a closed day: the door re-derives it, and refuses the same draw twice
    c += 86_400_000
    for (let i = 6; i < 10; i++) live.record(PASSES[i]!, { tenant_id: 'acme' })
    const day = chainPeriods(live.snapshot().events, 'day')[0]!
    const req = { workflow_id: WF, unit: 'day' as const, start: day.start, rates: { PASS: 0.5, FAIL: 0.5 } }
    expect(both(l => l.commitSample(req))).toBe('ok')
    expect(both(l => l.commitSample(req))).toMatch(/SampleRefused: this draw is already committed \(seq \d+\)/)

    // the incremental list and registry are what a fresh read gives
    const db = live.decisionBook()
    expect(db.ok).toBe(true)
    expect(live.decisions().map(d => d.decision_id)).toEqual(db.decisions.map(d => d.decision_id))
    expect(live.decisions()).toEqual(reopen().decisions())
    expect(registryOf(db.keys, [ROOT.pub]).snapshot()).toEqual(db.registry!.keys)
  })
})
