/**
 * Authority rulings (2026-10-02; src/ruling.ts) and `riposte-replay` (src/replay-command.ts).
 * A ruling is a person's call-scoped decision on ONE verdict: signed, pinned to its role, within the role's mandate (the
 * verdict's authority remedies), spent once, never a waiver. It changes no verdict.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateSigningKeypair, splitApLayout, canonicalize, verifyInvoiceMatch } from 'riposte-verify'
import {
  apGate, makeRuling, signRuling, checkRuling, mandateOf, rulingIdOf, authoritiesFromJson, ledgerCli, replayCli, parseLedger,
  handleMcpRequest, openLedger, memoryStore, verifyChain, rootedJsonReader, RULING_SIGNING_PREFIX,
  type Authorities, type LedgerEntry, type ReplayFs,
} from '../src/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const NOW = (): Date => new Date('2026-10-02T00:00:00.000Z')
const CASES = readFileSync(join(HERE, '..', '..', 'verify', 'data', 'real', 'D-ap-distil', 'invoice_cases.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { id: string; input: string; decision: string })
// engine 0.6.0: history known and empty, so the duplicate check runs and passes; without it every approve is PASS-WITH-OPEN,
// and the open duplicate claim is a rule no buyer's ruling covers
const docsFor = (decision: string, nth = 0) => ({ ...splitApLayout(CASES.filter((c) => c.decision === decision)[nth]!.input)!, history: [] })

const buyer = generateSigningKeypair()
const supervisor = generateSigningKeypair()
const stranger = generateSigningKeypair()
const AUTH: Authorities = { buyer: buyer.publicKeyPem, 'ap-supervisor': [supervisor.publicKeyPem] }

const rule = (verdict_id: string, rules: string[], by: string, decision: 'allow' | 'deny', key = buyer.privateKeyPem) =>
  signRuling(makeRuling({ verdict_id, rules, by, decision, note: 'approved on the phone with the vendor', now: NOW }), key)

describe('a ruling covers one verdict, within one role\'s mandate, once', () => {
  const price = docsFor('hold_price')
  const v = verifyInvoiceMatch(price, { now: NOW }).verdict

  it('the mandate is what the verdict\'s authority remedies name for that role (and nothing that PASSed)', () => {
    expect(mandateOf(v, 'buyer')).toEqual(['AP_PRICE_PO'])
    expect(mandateOf(v, 'ap-controller')).toEqual([])
  })

  it('a valid allow, the model proposing to pay: EXECUTE PAY on the person\'s decision; the verdict is unchanged', () => {
    const before = canonicalize(v)
    const r = rule(v.verdict_id, ['AP_PRICE_PO'], 'buyer', 'allow')
    const g = apGate('approve', price, { now: NOW, rulings: [r], authorities: AUTH })
    expect(g).toMatchObject({ action: 'EXECUTE', effect: 'PAY', checker_decision: 'hold_price', ruling: { consumed: [r.ruling_id], refused: [] } })
    expect(g.reason).toContain(`buyer's ruling ${r.ruling_id}`)
    expect(g.check.verdict.outcome).toBe('FAIL') // the FAIL stays on the record
    expect(canonicalize({ ...g.check.verdict, issued_at: v.issued_at })).toBe(before)
  })

  it('a ruling for verdict A does not clear verdict B', () => {
    const qty = docsFor('hold_price', 1)
    const b = verifyInvoiceMatch(qty, { now: NOW }).verdict
    expect(b.verdict_id).not.toBe(v.verdict_id)
    const forA = rule(v.verdict_id, ['AP_PRICE_PO'], 'buyer', 'allow')
    const g = apGate('approve', qty, { now: NOW, rulings: [forA], authorities: AUTH })
    expect(g).toMatchObject({ action: 'REVIEW', effect: 'HUMAN_REVIEW' })
    expect(g.ruling).toBeUndefined() // not even considered: it names another verdict
    // and named explicitly against B, it is refused for the verdict it names
    expect(checkRuling(forA, b, { authorities: AUTH })).toMatchObject({ ok: false, reason: `the ruling is for verdict ${v.verdict_id}, not ${b.verdict_id}: a ruling covers one verdict only` })
  })

  it('an unsigned ruling is refused', () => {
    const unsigned = { ruling: makeRuling({ verdict_id: v.verdict_id, rules: ['AP_PRICE_PO'], by: 'buyer', decision: 'allow', note: 'n', now: NOW }) }
    const withId = { ...unsigned, ruling_id: rulingIdOf(unsigned.ruling) }
    const g = apGate('approve', price, { now: NOW, rulings: [withId], authorities: AUTH })
    expect(g).toMatchObject({ action: 'REVIEW', ruling: { consumed: [], refused: [{ reason: 'unsigned: a ruling counts only when signed by a key pinned for its role' }] } })
  })

  it('a wrong-key ruling is refused: a stranger\'s key, or the key pinned for another role', () => {
    const s = rule(v.verdict_id, ['AP_PRICE_PO'], 'buyer', 'allow', stranger.privateKeyPem)
    expect(checkRuling(s, v, { authorities: AUTH }).reason).toMatch(/^signed by a key that is not pinned for role 'buyer'/)
    const other = rule(v.verdict_id, ['AP_PRICE_PO'], 'buyer', 'allow', supervisor.privateKeyPem)
    expect(checkRuling(other, v, { authorities: AUTH }).reason).toMatch(/^signed by a key that is not pinned for role 'buyer'/)
    expect(checkRuling(rule(v.verdict_id, ['AP_PRICE_PO'], 'buyer', 'allow'), v, {}).reason).toBe("no key is pinned for role 'buyer': only a pinned authority's ruling counts")
    expect(apGate('approve', price, { now: NOW, rulings: [s], authorities: AUTH }).action).toBe('REVIEW')
  })

  it('an altered ruling is refused (its id, or its signature); a ruling signature is domain-separated', () => {
    const r = rule(v.verdict_id, ['AP_PRICE_PO'], 'buyer', 'allow')
    const widened = { ...r, ruling: { ...r.ruling, note: 'any price is fine, forever' } }
    expect(checkRuling(widened, v, { authorities: AUTH }).reason).toBe('ruling_id does not derive from the ruling (altered after it was written)')
    const rehashed = { ...widened, ruling_id: rulingIdOf(widened.ruling) }
    expect(checkRuling(rehashed, v, { authorities: AUTH }).reason).toBe('the signature does not verify: the ruling was altered, or the key does not match')
    expect(RULING_SIGNING_PREFIX).toBe('riposte:authority-ruling:v1\n')
  })

  it('outside the mandate: the buyer cannot rule on a total that does not add up (that is the AP supervisor\'s)', () => {
    const total = docsFor('hold_total')
    const t = verifyInvoiceMatch(total, { now: NOW }).verdict
    const r = rule(t.verdict_id, ['AP_TOTAL_SUM'], 'buyer', 'allow')
    expect(checkRuling(r, t, { authorities: AUTH }).reason).toBe("role 'buyer' has no mandate over AP_TOTAL_SUM in this verdict (its authority remedies cover: nothing)")
    const ok = rule(t.verdict_id, ['AP_TOTAL_SUM'], 'ap-supervisor', 'allow', supervisor.privateKeyPem)
    expect(apGate('approve', total, { now: NOW, rulings: [r, ok], authorities: AUTH })).toMatchObject({ action: 'EXECUTE', effect: 'PAY', ruling: { consumed: [ok.ruling_id] } })
  })

  it('spent once: a consumed ruling does not pay the same invoice again', () => {
    const r = rule(v.verdict_id, ['AP_PRICE_PO'], 'buyer', 'allow')
    const g = apGate('approve', price, { now: NOW, rulings: [r], authorities: AUTH, consumed: new Set([r.ruling_id]) })
    expect(g).toMatchObject({ action: 'REVIEW', ruling: { consumed: [], refused: [{ ruling_id: r.ruling_id, reason: 'already consumed: a ruling is spent once, on one action' }] } })
  })

  it('deny holds on the person\'s decision; an allow does not turn a proposed hold into a payment', () => {
    const d = rule(v.verdict_id, ['AP_PRICE_PO'], 'buyer', 'deny')
    expect(apGate('approve', price, { now: NOW, rulings: [d], authorities: AUTH })).toMatchObject({ action: 'EXECUTE', effect: 'HOLD', ruling: { consumed: [d.ruling_id] } })
    const a = rule(v.verdict_id, ['AP_PRICE_PO'], 'buyer', 'allow')
    const g = apGate('hold_quantity', price, { now: NOW, rulings: [a], authorities: AUTH })
    expect(g).toMatchObject({ action: 'REVIEW', ruling: { consumed: [] } })
    expect(g.reason).toContain('the model proposed "hold_quantity", not a payment')
  })

  it('an allow must cover EVERY open rule: a partial ruling leaves the rest named', () => {
    const nopo = docsFor('hold_no_po')
    const n = verifyInvoiceMatch(nopo, { now: NOW }).verdict
    const open = [...new Set(n.claims.filter((c) => c.outcome !== 'PASS').map((c) => c.rule_id))].sort()
    expect(open.length).toBeGreaterThan(1)
    const part = rule(n.verdict_id, ['AP_PO_MATCH'], 'buyer', 'allow')
    const g = apGate('approve', nopo, { now: NOW, rulings: [part], authorities: AUTH })
    expect(g.action).toBe('REVIEW')
    expect(g.reason).toContain(`the rulings do not cover ${open.filter((x) => x !== 'AP_PO_MATCH').join(', ')}`)
  })
})

describe('authoritiesFromJson', () => {
  it('reads PEMs inline or by path, and refuses anything that is not a public key', () => {
    const a = authoritiesFromJson({ buyer: buyer.publicKeyPem, clerk: ['k.pem'] }, () => supervisor.publicKeyPem)
    expect(a.buyer).toEqual([buyer.publicKeyPem])
    expect(() => authoritiesFromJson({ buyer: 'nope.pem' }, () => 'not a key')).toThrow(/is not a public key/)
    expect(() => authoritiesFromJson([], () => '')).toThrow()
  })
})

// ── the whole loop on a ledger: ap_gate (MCP) → riposte-ledger rule → ap_gate again → riposte-replay ─────────────────
function fileLedger() {
  const files = new Map<string, string>()
  return {
    files,
    readFile: (p: string): string => { const t = files.get(p); if (t === undefined) throw new Error(`ENOENT: ${p}`); return t },
    append: (p: string, text: string): void => { files.set(p, (files.get(p) ?? '') + text) },
  }
}
const store = (fl: ReturnType<typeof fileLedger>, path: string) => ({
  load: (): LedgerEntry[] => fl.files.has(path) ? parseLedger(fl.files.get(path)!) : [],
  append: (e: LedgerEntry): void => fl.append(path, JSON.stringify(e) + '\n'),
})
const call = (deps: Parameters<typeof handleMcpRequest>[1], args: unknown) =>
  (handleMcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ap_gate', arguments: args } }, deps) as { result: { structuredContent: Record<string, any> } }).result.structuredContent

describe('on the ledger: the gate, the ruling, the replay', () => {
  const fl = fileLedger()
  const L = 'book/receipts.jsonl'
  const service = generateSigningKeypair()
  // each gate call issues its verdict one second after the last, so two receipts of one verdict never share a verdict hash
  let tick = Date.parse('2026-10-02T00:00:00.000Z')
  const deps = { ledger: openLedger(store(fl, L), { signingKey: service.privateKeyPem, now: NOW }), read: rootedJsonReader(HERE), authorities: AUTH, now: () => new Date((tick += 1000)) }
  const layout = CASES.filter((c) => c.decision === 'hold_price')[0]!.input
  fl.files.set('buyer.pem', buyer.privateKeyPem)
  fl.files.set('stranger.pem', stranger.privateKeyPem)

  let firstProof: unknown
  it('runs end to end: REVIEW with remedies → a signed ruling appended → EXECUTE PAY once → REVIEW again; the chain verifies', () => {
    const first = call(deps, { decision: 'approve', layout, history: [] }) // engine 0.6.0: history known and empty
    expect(first).toMatchObject({ action: 'REVIEW', checker_decision: 'hold_price', receipt: { stored: 'hashes' } })
    expect(first.remedies.some((r: { kind: string; authority?: string }) => r.kind === 'authority' && r.authority === 'buyer')).toBe(true)
    // Hashes only by default (2026-10-03): the proof comes back to the caller; the ledger holds no document text.
    expect(first.proof.verdict.verdict_id).toBe(first.verdict_id)
    firstProof = first.proof
    const onLedger = fl.files.get(L)!
    expect(onLedger).not.toContain('"proof"')
    for (const s of ['PURCHASE ORDER', 'GOODS RECEIPT', 'Vendor:']) expect(onLedger).not.toContain(s)
    const vid = first.verdict_id as string

    // a role with no mandate is refused, and nothing is appended
    const lenBefore = parseLedger(fl.files.get(L)!).length
    const no = ledgerCli(['rule', L, '--verdict', vid, '--by', 'ap-controller', '--decision', 'allow', '--note', 'x', '--key', 'buyer.pem'], fl.readFile, { append: fl.append, now: NOW })
    expect(no.code).toBe(1)
    expect(no.err).toContain("role 'ap-controller' has no mandate in verdict")
    expect(parseLedger(fl.files.get(L)!).length).toBe(lenBefore)

    // the buyer rules: the verdict is found on the ledger, the mandate fills the rules
    const ok = ledgerCli(['rule', L, '--verdict', vid, '--by', 'buyer', '--decision', 'allow', '--note', 'agreed price uplift, PO change to follow', '--key', 'buyer.pem'], fl.readFile, { append: fl.append, now: NOW })
    expect(ok.code).toBe(0)
    expect(JSON.parse(ok.out)).toMatchObject({ verdict_id: vid, rules: ['AP_PRICE_PO'], by: 'buyer', decision: 'allow', signed: true, verdict_found: true })

    const second = call(deps, { decision: 'approve', layout, history: [] })
    expect(second).toMatchObject({ action: 'EXECUTE', effect: 'PAY', ruling: { consumed: [JSON.parse(ok.out).ruling_id] } })
    const third = call(deps, { decision: 'approve', layout, history: [] })
    expect(third).toMatchObject({ action: 'REVIEW', ruling: { consumed: [] } })
    expect(third.ruling.refused[0].reason).toBe('already consumed: a ruling is spent once, on one action')

    const entries = parseLedger(fl.files.get(L)!)
    expect(entries.map((e) => e.kind)).toEqual(['ap_gate', 'ruling', 'ap_gate', 'ap_gate'])
    expect(verifyChain(entries)).toMatchObject({ ok: true, length: 4 })
  })

  it('a stranger\'s ruling, appended, is refused at the gate (signed, but not by a pinned key)', () => {
    const vid = call(deps, { decision: 'approve', layout: CASES.filter((c) => c.decision === 'hold_price')[1]!.input }).verdict_id as string
    const s = ledgerCli(['rule', L, '--verdict', vid, '--by', 'buyer', '--decision', 'allow', '--note', 'trust me', '--key', 'stranger.pem'], fl.readFile, { append: fl.append, now: NOW })
    expect(s.code).toBe(0)
    const g = call(deps, { decision: 'approve', layout: CASES.filter((c) => c.decision === 'hold_price')[1]!.input })
    expect(g.action).toBe('REVIEW')
    expect(g.ruling.refused[0].reason).toMatch(/^signed by a key that is not pinned for role 'buyer'/)
  })

  it('an unsigned ruling can be recorded (said so), and is refused at the gate', () => {
    const vid = call(deps, { decision: 'approve', layout: CASES.filter((c) => c.decision === 'hold_price')[2]!.input }).verdict_id as string
    const u = ledgerCli(['rule', L, '--verdict', vid, '--by', 'buyer', '--decision', 'allow', '--note', 'n'], fl.readFile, { append: fl.append, now: NOW })
    expect(u.code).toBe(0)
    expect(u.err).toContain('ap_gate refuses it')
    expect(call(deps, { decision: 'approve', layout: CASES.filter((c) => c.decision === 'hold_price')[2]!.input }).action).toBe('REVIEW')
  })

  it('riposte-replay --ledger --entry: a hashes-only receipt says to bring the proof; the proof the caller kept binds and replays', () => {
    fl.files.set('proof0.json', JSON.stringify(firstProof))
    const fs: ReplayFs = { readFile: fl.readFile, listDir: () => undefined, join: (d, n) => `${d}/${n}` }
    const bare = replayCli(['--ledger', L, '--entry', '0'], fs)
    expect(bare.code).toBe(3)
    expect(bare.err).toContain('stores hashes only')
    // this ledger is in memory, with no head record beside it: replay does not call it intact (2026-10-05) unless --no-sidecar
    const noRecord = replayCli(['--ledger', L, '--entry', '0', '--proof', 'proof0.json'], fs)
    expect(noRecord.code).toBe(1)
    expect(noRecord.err).toContain('no head record found')
    const r = replayCli(['--ledger', L, '--entry', '0', '--proof', 'proof0.json', '--no-sidecar'], fs)
    expect(r.code).toBe(0)
    expect(JSON.parse(r.out)).toMatchObject({ total: 1, matched: 1, cases: [{ result: 'MATCH', answer: 'FAIL' }], bindings: [{ entry: 0, bound: true }] })
    expect(r.err).toContain('remedy: authority buyer → AP_PRICE_PO')
    expect(r.err).toContain('HOLD (gate: hold_price) · verdict FAIL')
    // found by its verdict id: the same invoice was gated three times (entries 0, 2, 3); the proof binds to its own receipt
    const byId = replayCli(['--ledger', L, '--proof', 'proof0.json', '--no-sidecar'], fs)
    expect(byId.code).toBe(0)
    expect(JSON.parse(byId.out).bindings).toEqual([{ proof: 'proof0.json', entry: 0, bound: true }])
    const byHash = replayCli(['--ledger', L, '--entry', parseLedger(fl.files.get(L)!)[0]!.hash.slice(0, 12), '--proof', 'proof0.json', '--no-sidecar'], fs)
    expect(byHash.code).toBe(0)
    // the same proof against another receipt of the same verdict does not bind: its verdict hash is not that receipt's
    const other = replayCli(['--ledger', L, '--entry', '2', '--proof', 'proof0.json', '--no-sidecar'], fs)
    expect(other.code).toBe(1)
    expect(JSON.parse(other.out).cases[0]).toMatchObject({ result: 'DIVERGED', first_difference: 'verdict_sha256' })
    expect(replayCli(['--ledger', L, '--entry', '1'], fs)).toMatchObject({ code: 3 }) // the ruling: no proof to replay
    expect(replayCli(['--ledger', L, '--entry', '999'], fs).code).toBe(3)
  })

  it('a doctored proof on the ledger (documents stored, the opt-in): the replay diverges and the broken chain is said', () => {
    const fl2 = fileLedger()
    const L2 = 'book/opted-in.jsonl'
    const deps2 = { ledger: openLedger(store(fl2, L2), { signingKey: service.privateKeyPem, now: NOW }), read: rootedJsonReader(HERE), authorities: AUTH }
    expect(call(deps2, { decision: 'approve', layout, store_documents: true })).toMatchObject({ action: 'REVIEW', receipt: { stored: 'documents' } })
    const lines = fl2.files.get(L2)!.trim().split('\n')
    const e0 = JSON.parse(lines[0]!) as { body: { proof: { verdict: { outcome: string } } } }
    expect(e0.body.proof.verdict.outcome).toBe('FAIL')
    e0.body.proof.verdict.outcome = 'PASS'
    const doctored = new Map([[L2, [JSON.stringify(e0), ...lines.slice(1)].join('\n') + '\n']])
    const fs: ReplayFs = { readFile: (p) => doctored.get(p)!, listDir: () => undefined, join: (d, n) => `${d}/${n}` }
    const r = replayCli(['--ledger', L2, '--entry', '0'], fs)
    expect(r.code).toBe(1)
    expect(JSON.parse(r.out).cases[0]).toMatchObject({ result: 'DIVERGED', first_difference: 'outcome' })
    expect(r.err).toContain("warning: the ledger's chain does not verify")
  })

  it('riposte-replay over bundle files and a folder', () => {
    const d = verifyInvoiceMatch(docsFor('approve'), { now: NOW })
    const b = { verdict: d.verdict, inputs: { ap: docsFor('approve'), policy: { price_tolerance: 0.02, total_tolerance: 0.005 } } }
    const files = new Map([['dir/a.json', JSON.stringify(b)], ['dir/b.jsonl', `${JSON.stringify(b)}\n${JSON.stringify(b)}\n`]])
    const fs: ReplayFs = { readFile: (p) => { const t = files.get(p); if (t === undefined) throw new Error('ENOENT'); return t }, listDir: (p) => (p === 'dir' ? ['b.jsonl', 'a.json'] : undefined), join: (x, n) => `${x}/${n}` }
    const r = replayCli(['dir'], fs)
    expect(r.code).toBe(0)
    expect(JSON.parse(r.out)).toMatchObject({ total: 3, matched: 3 })
    expect(replayCli(['dir/a.json'], fs)).toMatchObject({ code: 0 })
    expect(replayCli([], fs).code).toBe(0) // usage
    expect(replayCli(['a', 'b'], fs).code).toBe(3)
  })
})
