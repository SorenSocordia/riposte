/**
 * 2026-10-04: arbitration case rows as signed `note` rows (source "arbitration") under a witnessed head, and the
 * `riposte-ledger case` verbs. Case rows are built here in verify's case-ledger format; the cosigners are fakes except in the
 * last block, which uses riposte-custody's own Witness when the sibling package is present (lab only; skipped elsewhere).
 */
import { describe, it, expect } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { canonicalize, generateSigningKeypair, sha256 } from 'riposte-verify'
import {
  ingestCaseLedger, witnessHead, caseRowsFrom, checkCaseRows, caseCli, openLedger, memoryStore, verifyChain, fileStore, keyFingerprint, shortKeyFingerprint,
  ARBITRATION_SOURCE, HEAD_WITNESSED, CASE_LEDGER_FORMAT,
  type CaseLedgerRow, type HeadCosigner, type CaseCliIO, type CustodyApi, type LedgerEntry,
} from '../src/index.js'

const GENESIS = '0'.repeat(64)
const NOW = () => new Date('2026-10-04T06:00:00Z')
/** A chained case ledger in verify's format: each row's prev is the previous row's sha256(canonical JSON). */
function caseLedger(caseId: string, kinds: string[], tweak: (i: number) => Record<string, unknown> = () => ({})): CaseLedgerRow[] {
  const out: CaseLedgerRow[] = []
  kinds.forEach((kind, i) => {
    const prev = i ? sha256(canonicalize(out[i - 1]!)) : GENESIS
    out.push({ format: CASE_LEDGER_FORMAT, seq: i + 1, prev, at: `2026-10-05T0${i}:00:00Z`, kind, data: { case_id: caseId, ...tweak(i) } } as CaseLedgerRow)
  })
  return out
}
const KINDS = ['case.open', 'move.accepted', 'verdict', 'case.resolve']
const fake = (by: string, ok = true): HeadCosigner => ({ cosign: (count, head) => (ok ? { ok: true, code: 'ok', detail: '', by, envelope: { type: 'witness', by, count, head } } : { ok: false, code: 'witness.head_not_current', detail: 'no', by }) })
const keys = generateSigningKeypair()
const notes = (es: LedgerEntry[]) => es.filter((e) => e.kind === 'note' && (e.body as { source?: string }).source === ARBITRATION_SOURCE)

describe('case rows as signed notes', () => {
  it('B2.1: one signed note per case row; the notes rebuild the case ledger exactly; B2.4: a re-run appends nothing, a grown case appends the new row', () => {
    const ledger = openLedger(memoryStore(), { signingKey: keys.privateKeyPem, now: NOW })
    const rows = caseLedger('case-a', KINDS)
    const r = ingestCaseLedger(ledger, rows)
    expect(r).toMatchObject({ ok: true, case_id: 'case-a', already: 0 })
    if (!r.ok) throw new Error('refused')
    expect(r.appended.map((a) => [a.case_seq, a.event])).toEqual([[1, 'case.open'], [2, 'move.accepted'], [3, 'verdict'], [4, 'case.resolve']])
    const es = ledger.entries()
    expect(notes(es).map((e) => (e.body as { case_row_sha256: string }).case_row_sha256)).toEqual(rows.map((x) => sha256(canonicalize(x))))
    expect(verifyChain(es, { publicKey: keys.publicKeyPem, requireSigned: true }).ok).toBe(true)
    expect(caseRowsFrom(es, 'case-a').map((x) => canonicalize(x))).toEqual(rows.map((x) => canonicalize(x)))
    expect(checkCaseRows(es, { 'case-a': rows })).toMatchObject({ ok: true, cases: [{ case_id: 'case-a', rows: 4, matches_case_dir: true }] })
    expect(ingestCaseLedger(ledger, rows)).toMatchObject({ ok: true, appended: [], already: 4 })
    const grown = caseLedger('case-a', [...KINDS, 'case.reopen'])
    expect(ingestCaseLedger(ledger, grown)).toMatchObject({ ok: true, already: 4, appended: [{ case_seq: 5, event: 'case.reopen' }] })
    expect(ledger.entries()).toHaveLength(5)
  })

  it('refuses, appending nothing: a broken case chain, a rewritten or cut case record, rows of two cases, an empty ledger', () => {
    const ledger = openLedger(memoryStore(), { now: NOW })
    const broken = caseLedger('case-b', KINDS)
    ;(broken[1]!.data as Record<string, unknown>).by = 'someone else'
    expect(ingestCaseLedger(ledger, broken)).toMatchObject({ ok: false, code: 'case.chain_broken' })
    expect(ingestCaseLedger(ledger, [])).toMatchObject({ ok: false, code: 'case.empty' })
    expect(ingestCaseLedger(ledger, [...caseLedger('case-c', ['case.open']), ...caseLedger('case-d', ['case.open']).map((x) => ({ ...x, seq: 2, prev: sha256(canonicalize(caseLedger('case-c', ['case.open'])[0]!)) }))])).toMatchObject({ ok: false })
    expect(ledger.entries()).toHaveLength(0)
    expect(ingestCaseLedger(ledger, caseLedger('case-e', KINDS)).ok).toBe(true)
    const rewritten = caseLedger('case-e', KINDS, (i) => (i === 0 ? { why: 'another reason' } : {}))
    expect(ingestCaseLedger(ledger, rewritten)).toMatchObject({ ok: false, code: 'case.rewritten' })
    expect(ingestCaseLedger(ledger, caseLedger('case-e', KINDS.slice(0, 2)))).toMatchObject({ ok: false, code: 'case.rewritten' })
    expect(ledger.entries()).toHaveLength(4)
  })

  it('checkCaseRows names a note whose case row was edited, and a case directory the notes do not rebuild', () => {
    const ledger = openLedger(memoryStore(), { now: NOW })
    ingestCaseLedger(ledger, caseLedger('case-f', KINDS))
    const es = structuredClone(ledger.entries())
    ;((es[2]!.body as { row: CaseLedgerRow }).row.data as Record<string, unknown>).verdict_id = 'edited'
    const c = checkCaseRows(es, { 'case-f': caseLedger('case-f', KINDS) })
    expect(c.ok).toBe(false)
    expect(c.problems.join('\n')).toMatch(/does not hash to the note's case_row_sha256/)
    expect(c.problems.join('\n')).toMatch(/do not rebuild the case directory's ledger/)
  })
})

describe('the witnessed head', () => {
  it('two distinct countersignatures write a head.witnessed note naming the count and head; fewer write nothing', () => {
    const ledger = openLedger(memoryStore(), { signingKey: keys.privateKeyPem, now: NOW })
    ingestCaseLedger(ledger, caseLedger('case-g', KINDS))
    const h = ledger.head()
    expect(witnessHead(ledger, [fake('w1'), fake('w2', false)])).toMatchObject({ ok: false, envelopes: [] })
    expect(witnessHead(ledger, [fake('w1'), fake('w1')])).toMatchObject({ ok: false })
    expect(witnessHead(ledger, [fake('w1'), { cosign: () => { throw new Error('offline') } }])).toMatchObject({ ok: false })
    expect(ledger.entries()).toHaveLength(4)
    const w = witnessHead(ledger, [fake('w1'), fake('w2')])
    expect(w).toMatchObject({ ok: true, count: h.count, head: h.head, witness_row: 4, by: ['w1', 'w2'] })
    const row = ledger.entries()[4]!
    expect(row.kind).toBe('note')
    expect(row.body).toMatchObject({ source: ARBITRATION_SOURCE, event: HEAD_WITNESSED, count: 4, head: h.head, by: ['w1', 'w2'] })
  })
})

// ── the CLI verbs ─────────────────────────────────────────────────────────────────────────────────────────────────────
function cliIo(dir: string, custody?: CustodyApi): CaseCliIO {
  return {
    readFile: (p) => readFileSync(p, 'utf8'),
    writeNewFile: (p, t) => writeFileSync(p, t, { flag: 'wx' }),
    isDir: (p) => { try { return statSync(p).isDirectory() } catch { return false } },
    join,
    openStore: (p) => fileStore(p),
    ...(custody ? { loadCustody: async () => custody } : {}),
  }
}

describe('riposte-ledger case', () => {
  it('ingest appends under the lock and re-runs as a no-op; usage and refusals exit 3 and 1', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coh3-case-'))
    try {
      const caseFile = join(dir, 'ledger.jsonl')
      writeFileSync(caseFile, caseLedger('case-h', KINDS).map((r) => canonicalize(r)).join('\n') + '\n')
      const keyFile = join(dir, 'k.pem'); writeFileSync(keyFile, keys.privateKeyPem)
      const led = join(dir, 'receipts.jsonl')
      const io = cliIo(dir)
      const a = await caseCli(['ingest', led, '--case', dir, '--ledger-key', keyFile], io)
      expect(a.code).toBe(0)
      expect(JSON.parse(a.out)).toMatchObject({ ok: true, case_id: 'case-h', already: 0 })
      const b = await caseCli(['ingest', led, '--case', caseFile, '--ledger-key', keyFile], io)
      expect(JSON.parse(b.out)).toMatchObject({ ok: true, appended: [], already: 4 })
      expect((await caseCli(['ingest', led], io)).code).toBe(3)
      expect((await caseCli(['bogus', led], io)).code).toBe(3)
      writeFileSync(caseFile, caseLedger('case-h', KINDS, (i) => (i === 2 ? { verdict_id: 'other' } : {})).map((r) => canonicalize(r)).join('\n') + '\n')
      const c = await caseCli(['ingest', led, '--case', caseFile, '--ledger-key', keyFile], io)
      expect(c.code).toBe(1)
      expect(c.err).toMatch(/case\.rewritten/)
      const fakeCustody = { charterProblems: () => ['the roster is empty'] } as unknown as CustodyApi
      writeFileSync(join(dir, 'charter.json'), '{}')
      expect((await caseCli(['witness', led, '--charter', join(dir, 'charter.json')], cliIo(dir, fakeCustody))).code).toBe(3)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

// ── with riposte-custody's own Witness (lab only) ─────────────────────────────────────────────────────────────────────────
const CUSTODY = fileURLToPath(new URL('../../custody/dist/index.js', import.meta.url))
describe.skipIf(!existsSync(CUSTODY))('with riposte-custody\'s Witness and checkWitnessedHead', () => {
  it('ingest → witness → check: OK; a re-signed rewrite passes the pinned chain and fails the witnessed head', async () => {
    const C = await import(pathToFileURL(CUSTODY).href) as CustodyApi & { CHARTER_FORMAT: string; Hand: { generate(label: string): { fingerprint: string; publicPem: string } } }
    const dir = mkdtempSync(join(tmpdir(), 'coh3-custody-'))
    try {
      const pems = Object.fromEntries(['w1', 'w2', 'op'].map((k) => { const kp = generateSigningKeypair(); writeFileSync(join(dir, `${k}.pem`), kp.privateKeyPem); return [k, kp] }))
      writeFileSync(join(dir, 'recorder.pem'), keys.privateKeyPem); writeFileSync(join(dir, 'recorder.pub.pem'), keys.publicKeyPem)
      // a custody charter names keys by the 16-hex short fingerprint (receipts keyFingerprint is the full 64-hex value since 2026-10-05)
      const member = (k: string, role: string) => ({ fingerprint: shortKeyFingerprint(pems[k]!.publicKeyPem), public_key: pems[k]!.publicKeyPem, role, label: k })
      const charter = {
        format: C.CHARTER_FORMAT, fleet: 'coh3-case-test', roster: [member('op', 'operator'), member('w1', 'monitor'), member('w2', 'monitor')],
        permissions: { operator: ['hold', 'release', 'propose', 'approve'], agent: ['hold', 'release', 'propose'], monitor: ['hold', 'witness'] },
        ceilings: { rate_per_min: 60, spend_usd_per_day: 0, tool_calls_per_task: 10 }, tools: [], authorities: [], rulesets: [], proposal_max_ttl_s: 3600,
        recorder: shortKeyFingerprint(keys.publicKeyPem), witness: { every: 8, window: 2 },
      }
      expect(C.charterProblems(charter)).toEqual([])
      writeFileSync(join(dir, 'charter.json'), JSON.stringify(charter))
      writeFileSync(join(dir, 'ledger.jsonl'), caseLedger('case-i', KINDS).map((r) => canonicalize(r)).join('\n') + '\n')
      const led = join(dir, 'receipts.jsonl')
      const io = cliIo(dir, C)
      expect((await caseCli(['ingest', led, '--case', dir, '--ledger-key', join(dir, 'recorder.pem')], io)).code).toBe(0)
      const w = await caseCli(['witness', led, '--charter', join(dir, 'charter.json'), '--ledger-key', join(dir, 'recorder.pem'), '--witness-key', join(dir, 'w1.pem'), '--witness-key', join(dir, 'w2.pem'), '--head-out', join(dir, 'head.json')], io)
      expect(w.err).toMatch(/custody check: OK/)
      expect(w.code).toBe(0)
      const ck = (ledgerFile: string) => caseCli(['check', ledgerFile, '--charter', join(dir, 'charter.json'), '--key', join(dir, 'recorder.pub.pem'), '--head', join(dir, 'head.json'), '--case', dir], io)
      const ok = await ck(led)
      expect(ok.err).toMatch(/riposte-ledger case check: OK/)
      expect(ok.code).toBe(0)
      // one witness only: refused, nothing written
      const one = await caseCli(['witness', led, '--charter', join(dir, 'charter.json'), '--ledger-key', join(dir, 'recorder.pem'), '--witness-key', join(dir, 'w1.pem'), '--witness-key', join(dir, 'w1.pem'), '--head-out', join(dir, 'head2.json')], io)
      expect(one.code).toBe(1)
      expect(existsSync(join(dir, 'head2.json'))).toBe(false)
      // the recorder rewrites a case row and re-signs every row: the pinned chain holds, the witnessed head does not
      const es = readFileSync(led, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as LedgerEntry)
      const re = openLedger(memoryStore(), { signingKey: keys.privateKeyPem, now: NOW })
      es.forEach((e, i) => { const b = structuredClone(e.body) as Record<string, any>; if (i === 1) b.row.data.by = 'rewritten'; re.append(e.kind, b) })
      const rewritten = join(dir, 'rewritten.jsonl')
      writeFileSync(rewritten, re.entries().map((e) => JSON.stringify(e)).join('\n') + '\n')
      const bad = await ck(rewritten)
      expect(bad.code).toBe(1)
      expect(bad.err).toMatch(/witnessed head: head\.not_in_ledger/)
      expect(verifyChain(re.entries(), { publicKey: keys.publicKeyPem, requireSigned: true }).ok).toBe(true)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
