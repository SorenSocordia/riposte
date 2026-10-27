/**
 * 2026-10-03, the public half: the gate reading on the AP gate, structured input on both MCP servers, replay over MCP
 * (verify's replay_proof, receipts' replay_receipt) and verify's POST /v1/replay, agreeing with the CLI on the 100 benchmark
 * proofs, and the single-writer lock of the file store. The hosted half (POST /v1/replay on riposte-serve, the hosted lock)
 * is test/hosted-r3.test.ts, held back with the server.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir, hostname } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { route, splitApLayout, verifyBillMatch, type ApStructuredInput } from 'riposte-verify'
import { handleRequest as verifyMcp } from '../../verify/src/mcp/server.js'
import {
  apGate, fileStore, handleMcpRequest, ledgerCli, lockHolder, memoryStore, openLedger, replayCli, verifyChain,
  LedgerStoreError, type Ledger, type ServerDeps,
} from '../src/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const NOW = () => new Date('2026-10-03T00:00:00Z')
const CASES = readFileSync(join(HERE, '..', '..', 'verify', 'data', 'real', 'D-ap-distil', 'invoice_cases.jsonl'), 'utf8').trim().split('\n')
  .map((l) => JSON.parse(l) as { id: string; input: string; decision: string })
const dirs: string[] = []
const tmp = (p: string): string => { const d = mkdtempSync(join(tmpdir(), p)); dirs.push(d); return d }
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })

const base = (): ApStructuredInput => ({
  schema: 'riposte.ap-input/0.1.0',
  bill: {
    invoice_number: 'NM-84665', vendor: { name: 'Northfield Material Handling' }, purchase_order_number: 'PO-48825', currency: 'USD', amount: 2695,
    line_items: [
      { purchase_order_line_item_id: 'pol-1', description: 'CORD EXT 50FT 12AWG', quantity: 5, unit_price: 47.3, amount: 236.5 },
      { purchase_order_line_item_id: 'pol-2', description: 'TAPE FLOOR YEL', quantity: 10, unit_price: 14.25, amount: 142.5 },
      { purchase_order_line_item_id: 'pol-3', description: 'SHELF WIRE 48IN', quantity: 24, unit_price: 96.5, amount: 2316 },
    ],
  },
  purchase_order: {
    purchase_order_number: 'PO-48825', vendor: { name: 'Northfield Material Handling' }, currency: 'USD', freight_allowed: false,
    line_items: [
      { id: 'pol-1', description: 'Extension cord 50 ft, 12 AWG', unit_price: 47.3 },
      { id: 'pol-2', description: 'Floor marking tape, yellow', unit_price: 14.25 },
      { id: 'pol-3', description: 'Wire shelving unit 48 in', unit_price: 96.5 },
    ],
  },
  item_receipts: [{ line_items: [
    { purchase_order_line_item_id: 'pol-1', quantity: 5 }, { purchase_order_line_item_id: 'pol-2', quantity: 10 }, { purchase_order_line_item_id: 'pol-3', quantity: 24 },
  ] }],
  // engine 0.6.0: history known and empty, so the duplicate check runs and passes (without it, an approve reads PASS-WITH-OPEN)
  payment_history: [],
})
const overPriced = (): ApStructuredInput => { const x = base(); x.bill.line_items[1]!.unit_price = 14.61; x.bill.line_items[1]!.amount = 146.1; x.bill.amount = 2698.6; return x }

const deps = (ledger: Ledger = openLedger(memoryStore(), { now: NOW })): ServerDeps => ({ ledger, read: () => ({}), now: NOW })
const call = (d: ServerDeps, name: string, args: unknown) => (handleMcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, d) as { result: { content: { text: string }[]; structuredContent: any; isError: boolean } }).result
const vcall = (name: string, args: unknown) => (verifyMcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) as { result: { content: { text: string }[]; structuredContent: any; isError: boolean } }).result

describe('the AP gate reads the verdict as a gate does', () => {
  it('every answer carries the gate reading; on the 100 benchmark invoices, with history known (and empty), it never reads PASS-WITH-OPEN when the checker approves, so no action moves', () => {
    let approves = 0
    for (const c of CASES) {
      const docs = { ...splitApLayout(c.input)!, history: [] } // engine 0.6.0: the duplicate check runs on an empty book
      const g = apGate(c.decision, docs, { now: NOW })
      expect(['PASS', 'FAIL', 'INSUFFICIENT_DATA', 'PASS-WITH-OPEN']).toContain(g.status)
      if (g.checker_decision === 'approve') { approves++; expect([c.id, g.status]).toEqual([c.id, 'PASS']) }
      // the old rule: EXECUTE exactly when the checker agrees
      const agrees = g.checker_decision !== 'abstain' && (g.checker_decision === c.decision)
      expect([c.id, g.action]).toEqual([c.id, agrees ? 'EXECUTE' : 'REVIEW'])
    }
    expect(approves).toBeGreaterThan(20)
  })
  it('engine 0.6.0: with no history supplied, every would-be approve reads PASS-WITH-OPEN, its only open claim the duplicate check, and goes to a person', () => {
    // The bills an empty book approves, re-checked with no book at all. Since 2026-10-05 the checker itself says abstain there
    // (the duplicate check did not run), where before it said approve beside PASS-WITH-OPEN; either way the gate's reading is
    // the same, and it never pays: REVIEW, a person, the duplicate check the only open claim.
    let approves = 0
    for (const c of CASES) {
      const docs = splitApLayout(c.input)!
      if (apGate(c.decision, { ...docs, history: [] }, { now: NOW }).checker_decision !== 'approve') continue
      approves++
      const g = apGate(c.decision, docs, { now: NOW })
      const open = g.check.verdict.claims.filter((x) => x.outcome === 'INSUFFICIENT_DATA').map((x) => x.claim_id)
      expect(['approve', 'abstain']).toContain(g.checker_decision)
      expect([c.id, g.status, open, g.action, g.effect]).toEqual([c.id, 'PASS-WITH-OPEN', ['ap.duplicate'], 'REVIEW', 'HUMAN_REVIEW'])
    }
    expect(approves).toBeGreaterThan(20)
  })
})

describe('structured AP input on the MCP tools', () => {
  it('receipts ap_gate: EXECUTE PAY on agreement, REVIEW with typed remedies on a planted price mismatch, the decision from structured.decision', () => {
    const d = deps()
    const pay = call(d, 'ap_gate', { decision: 'approve', structured: base() })
    expect(pay.isError).toBe(false)
    expect(pay.structuredContent).toMatchObject({ action: 'EXECUTE', effect: 'PAY', checker_decision: 'approve', status: 'PASS' })
    expect(pay.structuredContent.proof.inputs.ap_structured.bill.invoice_number).toBe('NM-84665')
    const inner = { ...overPriced(), decision: { action: 'pay' as const } }
    const rev = call(d, 'ap_gate', { structured: inner })
    expect(rev.structuredContent).toMatchObject({ action: 'REVIEW', checker_decision: 'hold_price', status: 'FAIL', model_decision: 'approve' })
    expect(rev.structuredContent.remedies.some((r: any) => r.authority === 'buyer')).toBe(true)
    // the receipt stores hashes only, never a document value
    const body = JSON.stringify(d.ledger.entries()[1]!.body)
    expect(body).not.toContain('Northfield')
    expect(body).not.toContain('14.61')
  })

  it('receipts ap_gate: a refusal names each field (typed errors under /structured); conflicting decisions and text alongside are refused', () => {
    const d = deps()
    const bad = base() as any; delete bad.bill.vendor
    const r = call(d, 'ap_gate', { decision: 'approve', structured: bad })
    expect(r.isError).toBe(true)
    expect(r.structuredContent.error.code).toBe('request.input_invalid')
    expect(r.structuredContent.error.errors.some((e: any) => e.field.startsWith('/structured/bill'))).toBe(true)
    expect(call(d, 'ap_gate', { decision: 'hold_price', structured: { ...base(), decision: { action: 'pay' } } }).structuredContent.error.code).toBe('request.decision_invalid')
    expect(call(d, 'ap_gate', { decision: 'approve', structured: base(), invoice: 'x' }).structuredContent.error.code).toBe('request.input_invalid')
    expect(d.ledger.entries()).toHaveLength(0)
  })

  it('verify verify_invoice_match: the same verdict as the library; an invalid input is a tool error naming the field', () => {
    const r = vcall('verify_invoice_match', { structured: overPriced() })
    expect(r.isError).toBe(false)
    const lib = verifyBillMatch(overPriced())
    expect(r.structuredContent.decision).toBe('hold_price')
    expect(r.structuredContent.verdict.verdict_id).toBe(lib.verdict.verdict_id)
    const bad = base() as any; bad.purchase_order.line_items[0].unit_price = 'twelve'
    const e = vcall('verify_invoice_match', { structured: bad })
    expect(e.isError).toBe(true)
    expect(e.structuredContent.errors[0].field).toMatch(/^\/structured\/purchase_order\/line_items\/0\/unit_price/)
    expect(vcall('verify_invoice_match', { structured: base(), layout: 'x' }).isError).toBe(true)
  })
})

describe('replay over HTTP and MCP agrees with the CLI', () => {
  // 100 benchmark invoices through the MCP gate (hashes-only receipts), each with the proof the caller kept
  const ledgerDir = tmp('r3-replay-')
  const ledgerPath = join(ledgerDir, 'receipts.jsonl')
  const d = deps(openLedger(fileStore(ledgerPath), { now: NOW }))
  const proofs: unknown[] = CASES.map((c) => call(d, 'ap_gate', { decision: c.decision, layout: c.input }).structuredContent.proof)
  const proofsPath = join(ledgerDir, 'proofs.jsonl')
  writeFileSync(proofsPath, proofs.map((p) => JSON.stringify(p)).join('\n') + '\n')
  const fs = { readFile: (p: string) => readFileSync(p, 'utf8'), listDir: () => undefined, join }

  it('receipts: replay_receipt over MCP gives the CLI\'s summary on all 100 kept proofs (BOUND + MATCH)', () => {
    const cli = replayCli(['--ledger', ledgerPath, '--proof', proofsPath], fs)
    expect(cli.code).toBe(0)
    const cliSummary = JSON.parse(cli.out)
    expect(cliSummary).toMatchObject({ total: 100, matched: 100 })
    const mcp = call(d, 'replay_receipt', { proofs })
    expect(mcp.isError).toBe(false)
    const { cases, total, matched, diverged, not_reperformed, refused, bindings } = mcp.structuredContent
    expect({ total, matched, diverged, not_reperformed, refused }).toEqual({ total: 100, matched: 100, diverged: 0, not_reperformed: 0, refused: 0 })
    expect(cases.map((c: any) => [c.result, c.verdict_id])).toEqual(cliSummary.cases.map((c: any) => [c.result, c.verdict_id]))
    expect(bindings.every((b: any) => b.bound)).toBe(true)
  })

  it('receipts: a proof with one changed byte in the invoice is NOT BOUND at documents.invoice.sha256; a swapped verdict at verdict_sha256', () => {
    const p = JSON.parse(JSON.stringify(proofs[0])) as any
    p.inputs.ap.invoice = p.inputs.ap.invoice.replace(/.$/s, (ch: string) => (ch === 'x' ? 'y' : 'x'))
    const one = call(d, 'replay_receipt', { entry: 0, proof: p })
    expect(one.structuredContent.cases[0]).toMatchObject({ result: 'DIVERGED', first_difference: 'documents.invoice.sha256' })
    const swapped = { ...(proofs[1] as object), verdict: (proofs[2] as any).verdict }
    const two = call(d, 'replay_receipt', { entry: 1, proof: swapped })
    expect(two.structuredContent.cases[0].result).toBe('DIVERGED')
    expect(two.structuredContent.cases[0].first_difference).toBe('verdict_sha256')
    // a hashes-only receipt alone is refused, naming why
    const alone = call(d, 'replay_receipt', { entry: 3 })
    expect(alone.isError).toBe(true)
    expect(alone.content[0]!.text).toContain('stores hashes only')
  })

  it('verify: POST /v1/replay and replay_proof re-perform the proofs themselves; a flipped outcome DIVERGES', () => {
    const http = route({ method: 'POST', path: '/v1/replay', body: { bundles: proofs } })
    expect(http.status).toBe(200)
    const s = (http.json as any).summary
    expect([s.total, s.matched]).toEqual([100, 100])
    expect((http.json as any).lines[0]).toMatch(/^MATCH/)
    const mcp = vcall('replay_proof', { bundles: proofs })
    expect(mcp.structuredContent.summary.cases.map((c: any) => c.result)).toEqual(s.cases.map((c: any) => c.result))
    const flipped = JSON.parse(JSON.stringify(proofs[0])) as any
    flipped.verdict.outcome = flipped.verdict.outcome === 'PASS' ? 'FAIL' : 'PASS'
    const bad = route({ method: 'POST', path: '/v1/replay', body: { bundle: flipped } })
    expect((bad.json as any).summary.diverged).toBe(1)
    expect(vcall('replay_proof', { bundle: flipped }).isError).toBe(true)
    expect(route({ method: 'POST', path: '/v1/replay', body: {} }).status).toBe(400)
    expect(route({ method: 'POST', path: '/v1/replay', body: { bundles: Array(1001).fill(proofs[0]) } }).status).toBe(400)
  })
})

describe('one writer per ledger: the file store\'s lock', () => {
  const deadPid = (): number => { const r = spawnSync(process.execPath, ['-e', ''], { windowsHide: true }); return r.pid! }

  it('the lock is taken on open, names this process, is shared within the process, and goes back on release', () => {
    const p = join(tmp('r3-lock-'), 'receipts.jsonl')
    const a = fileStore(p, { lock: true })
    openLedger(a, { now: NOW }).append('note', { n: 1 })
    const held = JSON.parse(readFileSync(`${p}.lock`, 'utf8'))
    expect(held).toMatchObject({ pid: process.pid, host: hostname(), ledger: 'receipts.jsonl' })
    const b = fileStore(p, { lock: true }) // the same process: not a second writer
    openLedger(b, { now: NOW }).append('note', { n: 2 })
    a.release()
    expect(existsSync(`${p}.lock`)).toBe(true) // b still holds it
    b.release()
    expect(existsSync(`${p}.lock`)).toBe(false)
    expect(() => b.head()).toThrow(/released/)
    expect(verifyChain(openLedger(fileStore(p)).entries()).ok).toBe(true)
  })

  it('a lock held by another running process refuses the open (ledger.locked, naming the pid), even with breakStale', () => {
    const p = join(tmp('r3-lock-'), 'receipts.jsonl')
    writeFileSync(`${p}.lock`, JSON.stringify({ pid: process.ppid, host: hostname(), started_at: '2026-10-03T00:00:00.000Z', ledger: 'receipts.jsonl' }) + '\n')
    for (const breakStale of [false, true]) {
      const s = fileStore(p, { lock: { breakStale } })
      let err: unknown
      try { s.head() } catch (e) { err = e }
      expect(err).toBeInstanceOf(LedgerStoreError)
      expect((err as LedgerStoreError).code).toBe('ledger.locked')
      expect((err as Error).message).toContain(`pid ${process.ppid}`)
      expect((err as Error).message).toContain('which is running')
    }
    expect(existsSync(p)).toBe(false) // nothing was written
  })

  it('a lock whose process is gone is refused without breakStale, and broken with it: moved aside byte for byte, recorded on the chain', () => {
    const p = join(tmp('r3-lock-'), 'receipts.jsonl')
    const stale = JSON.stringify({ pid: deadPid(), host: hostname(), started_at: '2026-10-02T00:00:00.000Z', ledger: 'receipts.jsonl' }) + '\n'
    writeFileSync(`${p}.lock`, stale)
    expect(() => fileStore(p, { lock: true }).head()).toThrow(/--break-lock/)
    const s = fileStore(p, { lock: { breakStale: true } })
    const ledger = openLedger(s, { now: NOW })
    const note = ledger.entries()[0]!
    expect(note.kind).toBe('note')
    expect(note.body).toMatchObject({ event: 'ledger.lock_broken', bytes: Buffer.byteLength(stale) })
    const aside = readdirSync(dirname(p)).find((f) => f.startsWith('receipts.jsonl.lock.broken-'))!
    expect(readFileSync(join(dirname(p), aside), 'utf8')).toBe(stale)
    expect(JSON.parse(readFileSync(`${p}.lock`, 'utf8')).pid).toBe(process.pid)
    s.release()
  })

  it('another host\'s lock is never broken here; a lock that does not parse needs breakStale', () => {
    const p = join(tmp('r3-lock-'), 'receipts.jsonl')
    writeFileSync(`${p}.lock`, JSON.stringify({ pid: 1, host: 'some-other-host', started_at: 'x' }))
    expect(() => fileStore(p, { lock: { breakStale: true } }).head()).toThrow(/never breaks the lock/)
    writeFileSync(`${p}.lock`, 'not json')
    expect(() => fileStore(p, { lock: true }).head()).toThrow(/names no process/)
    const s = fileStore(p, { lock: { breakStale: true } })
    expect(s.head()).toEqual({ count: 0, head: expect.any(String) })
    s.release()
  })

  it('riposte-ledger rule never appends past a running server: it says to post the ruling to the server instead', () => {
    const p = join(tmp('r3-lock-'), 'receipts.jsonl')
    const d0 = deps(openLedger(fileStore(p), { now: NOW }))
    call(d0, 'ap_gate', { decision: 'approve', structured: overPriced(), store_documents: true })
    const vid = d0.ledger.entries()[0]!.body as { verdict_id: string }
    writeFileSync(`${p}.lock`, JSON.stringify({ pid: process.ppid, host: hostname(), started_at: 'x' }))
    let appended = ''
    const r = ledgerCli(['rule', p, '--verdict', vid.verdict_id, '--by', 'buyer', '--decision', 'allow', '--note', 'ok'], (f) => readFileSync(f, 'utf8'), { append: (_f, t) => { appended += t }, now: NOW, lockHolder: (f) => lockHolder(f) })
    expect(r.code).toBe(3)
    expect(r.err).toContain('held by a running server')
    expect(r.err).toContain('/v1/ap/rulings')
    expect(appended).toBe('')
  })
})
