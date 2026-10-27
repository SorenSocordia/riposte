/**
 * Ledger disk (2026-09-28): `openFileLedger(path, { payloads: 'disk' })` keeps every verdict in the book's file and reads it
 * back on demand, and P-G keeps the book reader so an incremental check reads only what was appended. These pin:
 *   DISK   the same book, the same answers: every read (records, stats, queries, checks, decisions, exports, the tenant report,
 *          a voice read) is byte-identical to the heap mode's, before and after live appends; the bytes on disk are identical.
 *   TRUST  a line changed on disk after the open is never served (LedgerFileChanged, named), and the check says the book no
 *          longer verifies; a book tampered before the open fails its first (full) check, as in the heap mode.
 *   TORN   torn tail and corruption behave exactly as in the heap mode.
 *   P-G    at every step the kept reader reads what a fresh full read reads; it resumes (the verified prefix is not re-read,
 *          the stated boundary); a failure is never resumed from; snapshots resume or read in full, never wrongly; and the
 *          first failure is the monolithic walk's (a structural break, else an altered payload, else a refused event).
 */
import { describe, it, expect, afterAll } from 'vitest'
import { createPrivateKey, createPublicKey } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync, appendFileSync, copyFileSync, rmSync, truncateSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verify, type Verdict } from '../src/index'
import {
  openFileLedger, parseChainJSONL, readChainFile, repairTornTail, writeChainFile, readDecisionBook, signDecision, makeGrant, makeKeyRegister,
  makeReview, linkEvent, chainPeriods, renderTenantReport, payloadViewOf, TornTailError, LedgerFileCorrupt, LedgerFileChanged,
  type Ledger, type FileLedger, type SignedDecision, type BookDecision, type DecisionBook, type LedgerEvent,
} from '../src/ledger/index'
import { openSnapshot } from '../src/opinion/index'
import { assessVoiceFromLedger, policyRef, type PromotionPolicy } from '../src/verdict/voice'
import { clean, broken, FIXED_NOW } from './fixtures/invoices'

const dir = mkdtempSync(join(tmpdir(), 'verify-ledger-disk-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
let n = 0
const tmpPath = (): string => join(dir, `book-${n++}.jsonl`)

const PASSES: Verdict[] = Array.from({ length: 40 }, (_, i) => verify({ ...clean, invoice_number: `LD-P${i}` }, { now: FIXED_NOW }))
const FAILS: Verdict[] = Array.from({ length: 10 }, (_, i) => verify({ ...broken, invoice_number: `LD-F${i}` }, { now: FIXED_NOW }))

function keyFromSeed(seedHex: string): { priv: string; pub: string } {
  const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(seedHex, 'hex')])
  const k = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })
  return { priv: k.export({ type: 'pkcs8', format: 'pem' }).toString(), pub: createPublicKey(k).export({ type: 'spki', format: 'pem' }).toString() }
}
const ROOT = keyFromSeed('a1'.repeat(32))
const OWNER = keyFromSeed('11'.repeat(32))
const LEAD = keyFromSeed('22'.repeat(32))
const POLICY: PromotionPolicy = {
  policy_version: 'promotion-policy-v0', policy_id: 'disk', version: '1.0.0', method: 'wilson', sidedness: 'one-sided',
  tiers: [{ tier: 'low', description: 'test tier', confidence: 0.9, advise: { min_n: 3, max_error: 0.5 }, gate: { min_n: 5, max_error: 0.4 }, autonomy: { min_n: 8, max_error: 0.3 } }],
}
const WF = `acme/${PASSES[0]!.ruleset.id}@${PASSES[0]!.ruleset.version}`

/** A clock that crosses days, and the signed acts a rich book carries. */
function actor(start = '2026-09-01T09:00:00Z') {
  let c = Date.parse(start)
  const clock = (): Date => new Date((c += 3_600_000))
  const iso = (): string => new Date(c).toISOString()
  return {
    clock, iso, nextDay: (): void => { c += 86_400_000 },
    reg: (key: { pub: string }, subject: string, roles: ('key_admin' | 'reviewer' | 'grant_signer' | 'policy_author')[]): SignedDecision<BookDecision> =>
      signDecision(makeKeyRegister({ subject_id: subject, public_key: key.pub, roles, signer_id: 'root', signed_at: iso() }), ROOT.priv) as SignedDecision<BookDecision>,
    grant: (level: 'advise' | 'gate'): SignedDecision<BookDecision> => signDecision(makeGrant({
      workflow_id: WF, level, consequence_tier: 'low', policy: policyRef(POLICY), signer_id: 'owner', signed_at: iso(),
    }), OWNER.priv) as SignedDecision<BookDecision>,
    review: (id: string, decision: 'UPHELD' | 'OVERTURNED' = 'UPHELD') => signDecision(makeReview({ verdict_id: id, decision, signer_id: 'ap-lead', signed_at: iso(), procedure: 're-performed' }), LEAD.priv),
  }
}

/**
 * A rich book: two tenants; reviews (a non-ASCII note); a re-record keeping its review; one verdict recorded by both tenants;
 * a key registry under a root key; a signed review; a grant; a committed sample of a closed day; and a LEGACY review (no
 * tenant), appended by hand as a book written before 2026-09-28 would carry it.
 */
function richBook(path: string): void {
  const a = actor()
  const led = openFileLedger(path, { now: a.clock, root_keys: [ROOT.pub] })
  for (let i = 0; i < 16; i++) {
    const v = i % 4 === 3 ? FAILS[i % FAILS.length]! : PASSES[i]!
    led.record(v, { tenant_id: i % 3 === 0 ? 'globex' : 'acme' })
    if (i % 3 === 1) led.review(v.verdict_id, { reviewer_id: 'rev', decision: i % 2 ? 'UPHELD' : 'OVERTURNED', note: 'geprüft ✓ 確認済み' })
  }
  led.record(PASSES[1]!, { tenant_id: 'acme' })
  led.record(PASSES[1]!, { tenant_id: 'globex' })
  led.decide(a.reg(OWNER, 'owner', ['grant_signer', 'key_admin']))
  led.decide(a.reg(LEAD, 'ap-lead', ['reviewer']))
  led.reviewSigned(a.review(PASSES[2]!.verdict_id))
  led.decide(a.grant('advise'))
  a.nextDay()
  for (let i = 16; i < 22; i++) led.record(PASSES[i]!, { tenant_id: 'acme' })
  const day = chainPeriods(led.snapshot().events, 'day')[0]!
  led.commitSample({ workflow_id: WF, unit: 'day', start: day.start, rates: { PASS: 0.5, FAIL: 0.5 } })
  const head = led.chainHead()
  const len = led.events().length
  led.close()
  const payload = { type: 'REVIEW', verdict_id: PASSES[4]!.verdict_id, review: { reviewer_id: 'legacy', decided_at: a.iso(), decision: 'OVERTURNED' } }
  const ev = linkEvent(len, head, { ts: payload.review.decided_at, type: 'REVIEW', verdict_id: payload.verdict_id, payload })
  appendFileSync(path, JSON.stringify({ ...ev, payload }) + '\n')
}

const noReused = (b: DecisionBook): DecisionBook => ({ ...b, check: { ...b.check, reused: undefined } })
const J = (x: unknown): string => JSON.stringify(x)
const TENANTS = [undefined, 'acme', 'globex', 'nobody']

/** Every read a caller can make, as bytes. */
function reads(l: Ledger): Record<string, string> {
  const ids = [...new Set(l.events().map(e => e.verdict_id))]
  const out: Record<string, string> = {
    head: l.chainHead(), events: J(l.events()), all: J(l.all()), jsonl: l.toJSONL(), chain: l.chainJSONL(),
    verify: J({ ...l.verifyContent(), reused: undefined }), structural: J(l.verifyChain()), book: J(noReused(l.decisionBook())), decisions: J(l.decisions()),
    snapshot: J(l.snapshot()),
  }
  for (const t of TENANTS) {
    out[`stats:${t}`] = J(l.stats(t))
    for (const q of [{}, { reviewed: true }, { reviewed: false }, { outcome: 'FAIL' as const }, { since: '2026-09-01T15:00:00.000Z' }]) out[`query:${t}:${J(q)}`] = J(l.query({ ...q, ...(t !== undefined ? { tenant_id: t } : {}) }))
    for (const id of ids) out[`get:${t}:${id}`] = J(l.get(id, t))
  }
  for (const t of [undefined, 'acme', 'globex']) {
    out[`report:${t}`] = renderTenantReport(l, { ...(t !== undefined ? { tenant_id: t } : {}), voice: { policy: POLICY, declarations: [{ workflow_id: WF, granted: 'advise', consequence_tier: 'low' }] } })
  }
  out.voice = J(assessVoiceFromLedger(l, WF, POLICY, { consequence_tier: 'low' }))
  out.view = J(openSnapshot(l.snapshot(), { scope: { tenant_id: 'acme' } }).records)
  return out
}

function openBoth(src: string): { heap: FileLedger; disk: FileLedger; hp: string; dp: string } {
  const hp = tmpPath(), dp = tmpPath()
  copyFileSync(src, hp)
  copyFileSync(src, dp)
  const a = actor('2026-09-10T09:00:00Z')
  return { heap: openFileLedger(hp, { now: a.clock, root_keys: [ROOT.pub] }), disk: openFileLedger(dp, { now: actor('2026-09-10T09:00:00Z').clock, root_keys: [ROOT.pub], payloads: 'disk' }), hp, dp }
}

describe('DISK: the same book, the same answers', () => {
  it('every read of a reopened book is byte-identical to the heap mode\'s, and the disk mode hands out views, not copies', () => {
    const src = tmpPath()
    richBook(src)
    const { heap, disk } = openBoth(src)
    expect(disk.payloads).toBe('disk')
    expect(heap.payloads).toBe('memory')
    expect(heap.verifyContent().ok).toBe(true)
    const want = reads(heap)
    const got = reads(disk)
    for (const k of Object.keys(want)) expect(got[k], k).toBe(want[k])
    expect(payloadViewOf(disk.snapshot().payloads)).toBeDefined()
    expect(payloadViewOf(heap.snapshot().payloads)).toBeUndefined()
    heap.close(); disk.close()
  })

  it('live appends write the same bytes and read the same, then and after a reopen', () => {
    const src = tmpPath()
    richBook(src)
    const { heap, disk, hp, dp } = openBoth(src)
    const a1 = actor('2026-09-12T09:00:00Z'), a2 = actor('2026-09-12T09:00:00Z')
    for (const [l, a] of [[heap, a1], [disk, a2]] as const) {
      l.verifyContent()
      for (let i = 22; i < 30; i++) l.record(i % 5 === 0 ? FAILS[i % 10]! : PASSES[i]!, { tenant_id: i % 2 ? 'acme' : 'globex' })
      l.review(PASSES[23]!.verdict_id, { reviewer_id: 'rev-2', decision: 'OVERTURNED' })
      l.record(PASSES[23]!, { tenant_id: 'acme' }) // re-record after a review
      l.reviewSigned(a.review(PASSES[24]!.verdict_id, 'OVERTURNED'))
      l.decide(a.grant('gate'))
      expect(l.verifyContent()).toMatchObject({ ok: true })
    }
    expect(readFileSync(dp).equals(readFileSync(hp))).toBe(true)
    const want = reads(heap)
    const got = reads(disk)
    for (const k of Object.keys(want)) expect(got[k], k).toBe(want[k])
    heap.close(); disk.close()
    const again = openFileLedger(dp, { payloads: 'disk', root_keys: [ROOT.pub] })
    expect(again.chainHead()).toBe(want.head)
    expect(again.verifyContent()).toMatchObject({ ok: true, length: JSON.parse(want.events).length })
    expect(J(again.all())).toBe(want.all)
  })

  it('a book BUILT in the disk mode is byte-identical to one built in the heap mode', () => {
    const hp = tmpPath(), dp = tmpPath()
    for (const [p, mode] of [[hp, 'memory'], [dp, 'disk']] as const) {
      const a = actor()
      const l = openFileLedger(p, { now: a.clock, payloads: mode })
      for (let i = 0; i < 12; i++) {
        l.record(PASSES[i]!, { tenant_id: i % 2 ? 'acme' : 'globex' })
        if (i % 4 === 1) l.review(PASSES[i]!.verdict_id, { reviewer_id: 'r', decision: 'UPHELD' })
      }
      l.record(PASSES[1]!, { tenant_id: 'acme' })
      expect(l.verifyContent().ok).toBe(true)
      l.close()
    }
    expect(readFileSync(dp).equals(readFileSync(hp))).toBe(true)
  })

  it('a chain export (no final newline) opens in the disk mode and appends onto its own line, as the heap mode does', () => {
    const src = tmpPath()
    richBook(src)
    const exp = tmpPath()
    writeChainFile(readChainFile(src), exp)
    const hp = tmpPath(), dp = tmpPath()
    copyFileSync(exp, hp); copyFileSync(exp, dp)
    for (const [p, mode] of [[hp, 'memory'], [dp, 'disk']] as const) {
      const l = openFileLedger(p, { now: actor('2026-09-20T00:00:00Z').clock, payloads: mode, root_keys: [ROOT.pub] })
      l.record(PASSES[39]!, { tenant_id: 'acme' })
      expect(J(l.get(PASSES[39]!.verdict_id))).toContain(PASSES[39]!.verdict_id)
      expect(l.verifyContent().ok).toBe(true)
      l.close()
    }
    expect(readFileSync(dp).equals(readFileSync(hp))).toBe(true)
  })
})

describe('TRUST: a line changed on disk after the open is never served', () => {
  /** Change one RECORD line in place, same length (a digit of issued_at). */
  function alterRecordLine(path: string, seq: number): void {
    const lines = readFileSync(path, 'utf8').split('\n')
    const line = lines[seq]!
    const at = line.indexOf('"issued_at":"') + 13
    lines[seq] = line.slice(0, at) + (line[at] === '1' ? '2' : '1') + line.slice(at + 1)
    writeFileSync(path, lines.join('\n'))
  }

  it('reading its verdict throws LedgerFileChanged (named); the check says the book does not verify; a reopen is a full check', () => {
    const p = tmpPath()
    richBook(p)
    const led = openFileLedger(p, { payloads: 'disk', root_keys: [ROOT.pub], cache: 1 }) // a parsed payload still cached is served as read
    expect(led.verifyContent().ok).toBe(true)
    alterRecordLine(p, 3)
    led.close() // drops the read-ahead window: bytes still in it are the ones this process read, and are served as read
    const id = led.events()[3]!.verdict_id
    expect(() => led.get(id, led.get(id)!.tenant_id)!.verdict).toThrow(LedgerFileChanged)
    expect(() => led.get(id)!.verdict).toThrow(/changed on disk after this process read it: the line of event seq 3/)
    expect(led.verifyContent().ok).toBe(true) // incremental: the verified prefix is this process's own (stated)
    const full = led.verifyContent({ full: true })
    expect(full).toMatchObject({ ok: false, brokenAt: 3 })
    expect(full.reason).toMatch(/LedgerFileChanged|changed on disk/)
    led.close()
    const reopened = openFileLedger(p, { payloads: 'disk', root_keys: [ROOT.pub] }) // the altered bytes are now the book: its hash fails
    expect(reopened.verifyContent()).toMatchObject({ ok: false, brokenAt: 3, reason: 'payload at 3 was altered (payload_hash mismatch)' })
    expect(openFileLedger(p, { root_keys: [ROOT.pub] }).verifyContent()).toMatchObject({ ok: false, brokenAt: 3, reason: 'payload at 3 was altered (payload_hash mismatch)' })
    reopened.close()
  })

  it('a file cut short after the open: its lines past the cut are named, never read as something else', () => {
    const p = tmpPath()
    richBook(p)
    const led = openFileLedger(p, { payloads: 'disk' })
    const last = led.events().filter(e => e.type === 'RECORD').pop()!
    truncateSync(p, statSync(p).size - 4000)
    expect(() => led.all().find(r => r.verdict.verdict_id === last.verdict_id)).toThrow(/changed on disk .* is cut short|no longer holds/)
    led.close()
  })
})

describe('the torn tail in the disk mode: exactly the heap mode\'s rules', () => {
  it('a torn last line opens read-only, every whole event reads and verifies, an append names the fix; repair, then append', () => {
    const p = tmpPath()
    richBook(p)
    const whole = readFileSync(p)
    appendFileSync(p, '{"seq":999,"ts":"2026-')
    const led = openFileLedger(p, { payloads: 'disk', root_keys: [ROOT.pub] })
    expect(led.readOnly).toBe(true)
    expect(led.torn).toMatchObject({ offset: whole.length })
    expect(led.verifyContent().ok).toBe(true)
    expect(led.all().length).toBeGreaterThan(0)
    expect(() => led.record(PASSES[39]!, { tenant_id: 'acme' })).toThrow(TornTailError)
    expect(readFileSync(p).length).toBe(whole.length + 22)
    led.close()
    expect(repairTornTail(p).repaired).toBe(true)
    const fixed = openFileLedger(p, { payloads: 'disk', root_keys: [ROOT.pub] })
    fixed.record(PASSES[39]!, { tenant_id: 'acme' })
    expect(fixed.verifyContent().ok).toBe(true)
    expect(fixed.get(PASSES[39]!.verdict_id)!.verdict.verdict_id).toBe(PASSES[39]!.verdict_id)
    fixed.close()
  })

  it('a torn line in the middle is corruption: the book does not open in either mode', () => {
    const p = tmpPath()
    richBook(p)
    const lines = readFileSync(p, 'utf8').split('\n')
    lines[5] = lines[5]!.slice(0, 40)
    writeFileSync(p, lines.join('\n'))
    expect(() => openFileLedger(p, { payloads: 'disk' })).toThrow(LedgerFileCorrupt)
    expect(() => openFileLedger(p)).toThrow(LedgerFileCorrupt)
  })
})

describe('P-G: the kept book reader reads what a fresh full read reads', () => {
  const fresh = (l: Ledger): DecisionBook => { const s = parseChainJSONL(l.chainJSONL()); return readDecisionBook(s.events, s.payloads, { root_keys: [ROOT.pub] }) }

  for (const mode of ['memory', 'disk'] as const) {
    it(`differential (${mode}): at every step the ledger's incremental read equals a fresh read of its export`, () => {
      const a = actor()
      const led = openFileLedger(tmpPath(), { now: a.clock, root_keys: [ROOT.pub], payloads: mode })
      const check = (): void => {
        const got = led.decisionBook()
        expect(noReused(got)).toEqual(noReused(fresh(led)))
        const snap = led.snapshot()
        expect(noReused(readDecisionBook(snap.events, snap.payloads, { root_keys: [ROOT.pub] }))).toEqual(noReused(got))
      }
      for (let i = 0; i < 5; i++) { led.record(PASSES[i]!, { tenant_id: 'acme' }); check() }
      led.decide(a.reg(OWNER, 'owner', ['grant_signer', 'key_admin'])); check()
      led.decide(a.reg(LEAD, 'ap-lead', ['reviewer'])); check()
      led.reviewSigned(a.review(PASSES[0]!.verdict_id)); check()
      led.review(PASSES[1]!.verdict_id, { reviewer_id: 'r', decision: 'OVERTURNED' }); check()
      led.decide(a.grant('advise')); check()
      a.nextDay()
      for (let i = 5; i < 9; i++) led.record(PASSES[i]!, { tenant_id: i % 2 ? 'acme' : 'globex' })
      check()
      const day = chainPeriods(led.snapshot().events, 'day')[0]!
      led.commitSample({ workflow_id: WF, unit: 'day', start: day.start, rates: { PASS: 1, FAIL: 1 } }); check()
      led.record(PASSES[9]!, { tenant_id: 'acme' }); check()
      expect(led.decisionBook().samples).toHaveLength(1)
      led.close()
    })
  }

  it('it resumes: an incremental read does not re-read the verified prefix (THE STATED BOUNDARY, now the book reader\'s too); full does', () => {
    const a = actor()
    const led = openFileLedger(tmpPath(), { now: a.clock })
    for (let i = 0; i < 6; i++) led.record(PASSES[i]!, { tenant_id: 'acme' })
    expect(led.decisionBook().ok).toBe(true)
    // An INCONSISTENT in-place edit (the verdict door would refuse it): before P-G every read re-walked the prefix and caught it.
    ;(led.get(PASSES[2]!.verdict_id)!.verdict as { outcome: string }).outcome = 'MAYBE'
    led.record(PASSES[6]!, { tenant_id: 'acme' })
    expect(led.decisionBook()).toMatchObject({ ok: true, check: { reused: { through: 6 } } })
    expect(led.verifyContent({ full: true })).toMatchObject({ ok: false, brokenAt: 2 })
    // a failure is never resumed from: restored, the next read walks the whole book and passes
    ;(led.get(PASSES[2]!.verdict_id)!.verdict as { outcome: string }).outcome = 'PASS'
    expect(led.decisionBook()).toMatchObject({ ok: true })
    expect(led.decisionBook().check.reused?.through).toBe(7)
    led.close()
  })

  it('snapshots: an older one (the reader is past it) reads in full and right; a newer one resumes; an edited copy is caught', () => {
    const a = actor()
    const led = openFileLedger(tmpPath(), { now: a.clock, payloads: 'disk' })
    for (let i = 0; i < 6; i++) led.record(PASSES[i]!, { tenant_id: 'acme' })
    const old = led.snapshot()
    led.decisionBook()
    for (let i = 6; i < 9; i++) led.record(PASSES[i]!, { tenant_id: 'acme' })
    led.decisionBook()
    const oldRead = readDecisionBook(old.events, old.payloads)
    expect(oldRead).toMatchObject({ ok: true, check: { length: 6 } })
    const s = parseChainJSONL(led.chainJSONL())
    expect(noReused(oldRead)).toEqual(noReused(readDecisionBook(s.events.slice(0, 6), s.payloads.slice(0, 6))))
    const now = led.snapshot()
    expect(readDecisionBook(now.events, now.payloads)).toMatchObject({ ok: true, check: { length: 9, reused: { through: 9 } } })
    const edited = led.snapshot()
    edited.payloads[1] = { ...(edited.payloads[1] as object), recorded_at: '2020-01-01T00:00:00.000Z' }
    expect(payloadViewOf(edited.payloads)!.pristine).toBe(1)
    expect(readDecisionBook(edited.events, edited.payloads)).toMatchObject({ ok: false, check: { brokenAt: 1 } })
    expect(readDecisionBook(now.events, now.payloads).ok).toBe(true) // the edit stayed in its copy
    led.close()
  })

  it('the first failure is the monolithic walk\'s: a later altered payload outranks an earlier relabelled event', () => {
    const led = openFileLedger(tmpPath(), { now: actor().clock })
    for (let i = 0; i < 8; i++) led.record(PASSES[i]!, { tenant_id: 'acme' })
    const s = parseChainJSONL(led.chainJSONL())
    const relabel = (e: LedgerEvent[]): LedgerEvent[] => e.map((ev, i) => (i === 2 ? { ...ev, ts: '2020-01-01T00:00:00.000Z' } : ev))
    expect(readDecisionBook(relabel(s.events), s.payloads)).toMatchObject({ ok: false, check: { brokenAt: 2, reason: "event 2's header (verdict_id, ts) does not match its hashed RECORD payload" } })
    const altered = s.payloads.map((p, i) => (i === 5 ? { ...(p as object), tenant_id: 'globex' } : p))
    expect(readDecisionBook(relabel(s.events), altered)).toMatchObject({ ok: false, check: { brokenAt: 5, reason: 'payload at 5 was altered (payload_hash mismatch)' } })
    led.close()
  })
})
