/**
 * Fail closed by default, strict replay semantics, and the messages an outside engineer could not act on (2026-10-05).
 * The cold readers of cold review round 2: "A CI user wiring exit codes gets fail-open by default" (PASS-WITH-OPEN exited 0 unless --gate
 * was given); `verify ap` printed APPROVE, payable true, exit 0 on a bill whose duplicate check never ran; --gate was accepted on
 * `ap` and did nothing; --strict failed the genuine shipped legal bundles for carrying document.producer while an edited copy
 * without it passed, and passed `issued_at: {"lol":1}`; REPLAY.md promised an inline PEM that could not parse; the stderr
 * fingerprint was 12 characters and a 12-character pin was refused; `verify replya verdict.json` ran a fresh check of the
 * verdict; a mistyped --ruleset or a --source that is text answered with a raw ENOENT; the usage hint named a command a source
 * checkout does not have.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { run, invokedAs } from '../src/cli'
import {
  verify, verifyCitations, signVerdict, generateSigningKeypair, verdictExit, apExit, exitHeaders, exitLine, renderGate,
  carriedDefaultVersion, carriedRulesetNames, issuedAtProblem, replayBundle, renderCaseReplay, type Verdict, type GateReading,
} from '../src/index'
import { ENGINE_VERSION } from '../src/version'
import { route } from '../src/http/router'
import { handleRequest } from '../src/mcp/server'
import * as inv from './fixtures/invoices'
import { scratch, cleanScratch } from './helpers/scratch'

const HERE = dirname(fileURLToPath(import.meta.url))
const NOW = (): Date => new Date('2026-10-05T00:00:00.000Z')
const BIN = Object.entries((JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8')) as { bin: Record<string, string> }).bin).find(([, v]) => v === 'dist/cli.js')![0]
const N18 = join(HERE, 'replay-n18')
const RS_V02 = join(HERE, '..', 'docs', 'examples', 'peppol-en16931.ruleset.v0.2.json')
type J = Record<string, unknown>
afterAll(() => cleanScratch())

function go(argv: string[]): { code: number; out: string; err: string; json: () => any } {
  let out = '', err = ''
  const code = run(argv, { out: s => { out += s }, err: s => { err += s } }) as number
  return { code, out, err, json: () => JSON.parse(out) }
}
const put = (dir: string, name: string, body: unknown): string => {
  const p = join(dir, name)
  writeFileSync(p, typeof body === 'string' ? body : JSON.stringify(body))
  return p
}
/** The bill of a cold reader in the controller's role (cold review round 2) (docs/AP-INPUT.md shape): every check passes but the duplicate check, which has no payment history. */
const noHistoryBill = (): J => ({
  schema: 'riposte.ap-input/0.1.0',
  bill: {
    invoice_number: 'SES-10422', vendor: { name: 'Summit Electrical Supply' }, purchase_order_number: 'PO-2210', currency: 'USD', amount: '4875.00',
    line_items: [
      { purchase_order_line_item_id: 'l1', quantity: 10, unit_price: '212.50', amount: '2125.00' },
      { purchase_order_line_item_id: 'l2', quantity: 50, unit_price: '31.00', amount: '1550.00' },
      { purchase_order_line_item_id: 'l3', quantity: 20, unit_price: '60.00', amount: '1200.00' },
    ],
  },
  purchase_order: {
    id: 'po-2210', purchase_order_number: 'PO-2210', currency: 'USD', freight_allowed: false,
    line_items: [
      { id: 'l1', description: 'MC cable 12/2 250 ft roll', quantity: 10, unit_price: '212.50' },
      { id: 'l2', description: 'EMT conduit 3/4 in x 10 ft', quantity: 50, unit_price: '31.00' },
      { id: 'l3', description: '20A 1P breaker', quantity: 20, unit_price: '60.00' },
    ],
  },
  item_receipts: [{ purchase_order_id: 'po-2210', line_items: [{ purchase_order_line_item_id: 'l1', quantity: 10 }, { purchase_order_line_item_id: 'l2', quantity: 50 }, { purchase_order_line_item_id: 'l3', quantity: 20 }] }],
})

describe('fail closed by default: only a clean PASS exits 0', () => {
  it('check: PASS-WITH-OPEN exits 2 and says why; --allow-open exits 0 and says it was the caller\'s choice; the verdict is the same', () => {
    const d = scratch('fc-')
    const v = verify(inv.clean, { now: NOW })
    const f = put(d, 'clean.json', inv.clean)
    const r = go([f])
    if (v.gate_status === 'PASS_WITH_OPEN') {
      expect(r.code).toBe(2)
      expect(r.err).toMatch(/^verify: PASS-WITH-OPEN: \d+ of \d+ checks could not run\n {2}exit 2: fails closed: every check that ran held, but \d+ check\(s\) could not run: /)
      const a = go([f, '--allow-open'])
      expect(a.code).toBe(0)
      expect(a.err).toMatch(/\n {2}exit 0 by --allow-open, the caller's stated choice: .*; a gate would hold\n$/)
      expect({ ...a.json(), issued_at: 0 }).toEqual({ ...r.json(), issued_at: 0 })
    } else {
      expect(v.gate_status).toBe('PASS')
      expect(r.code).toBe(0)
    }
    expect(go([put(d, 'broken.json', inv.broken)]).code).toBe(1)
  })

  it('check: --gate keeps its own message and the same exit; --gate with --allow-open is a usage error', () => {
    const args = [join(N18, 'peppol-N18.extraction.json'), '--ruleset', RS_V02, '--source', join(N18, 'peppol-N18.txt')]
    const plain = go(args), gate = go([...args, '--gate'])
    expect([plain.code, gate.code]).toEqual([2, 2])
    expect(gate.err).toMatch(/^verify: OPEN: /)
    const both = go([...args, '--gate', '--allow-open'])
    expect(both.code).toBe(3)
    expect(both.err).toMatch(/--gate and --allow-open read an open verdict two ways: give one/)
  })

  it('verdictExit: the one table the CLI, HTTP and MCP share', () => {
    const open = verify(inv.clean, { now: NOW })
    const e = verdictExit(open)
    expect(e.exit).toBe(open.gate_status === 'PASS' ? 0 : 2)
    expect(verdictExit(verify(inv.broken, { now: NOW })).exit).toBe(1)
    if (open.gate_status === 'PASS_WITH_OPEN') {
      expect(verdictExit(open, true)).toMatchObject({ exit: 0, allow_open: true })
      expect(exitHeaders(verdictExit(open, true))).toEqual({ 'x-verify-gate': 'PASS-WITH-OPEN', 'x-verify-exit': '0', 'x-verify-allow-open': 'stated' })
      expect(exitLine(e)).toMatch(/^gate: PASS-WITH-OPEN · exit 2 \(do not act on it as passed\): fails closed: /)
    }
  })

  it('ap: an abstain (a check could not run) exits 2; a hold exits 1; --gate is accepted and changes nothing', () => {
    const d = scratch('ap-')
    const bill = put(d, 'bill.json', noHistoryBill())
    const r = go(['ap', '--input', bill])
    const result = r.json() as { decision: string; payable: boolean | null; verdict: Verdict }
    expect(result.verdict.gate_status).toBe('PASS_WITH_OPEN')
    expect(r.code).toBe(2)
    expect(r.err.split('\n')[0]).toMatch(/^verify ap: A PERSON DECIDES · verdict PASS-WITH-OPEN: 1 of \d+ checks could not run$/)
    expect(result).toMatchObject({ decision: 'abstain', payable: false })
    expect(r.json().exit).toBeUndefined() // without --allow-open the decision object is exactly what it was
    expect(go(['ap', '--input', bill, '--gate']).code).toBe(2)
    expect(go(['ap', '--input', bill, '--gate', '--allow-open']).code).toBe(3)
    expect(go(['ap', join(HERE, 'fixtures', 'data', 'ap-three-way.txt')]).code).toBe(1) // hold_quantity
    expect(go(['ap', '--help']).err).toContain('--gate | --allow-open')
  })

  it('ap --allow-open accepts only a bill held because no payment history was given; any other abstain stays exit 2 and says so', () => {
    const d = scratch('ap-allow-')
    const bill = put(d, 'bill.json', noHistoryBill())
    const r = go(['ap', '--input', bill, '--allow-open'])
    expect(r.code).toBe(0)
    expect(r.json()).toMatchObject({ decision: 'abstain', payable: false, exit: 0, allow_open: 'stated' }) // the decision stays the gate's
    // never APPROVE when the decision is abstain: the flag moves the exit code, not the decision
    expect(r.err.split('\n')[0]).toMatch(/^verify ap: A PERSON DECIDES, exit 0 by --allow-open · verdict PASS-WITH-OPEN: 1 of \d+ checks could not run$/)
    expect(r.err).not.toContain('APPROVE')
    expect(r.err.split('\n')[1]).toBe('  exit 0 by --allow-open, the caller\'s stated choice: the duplicate check did not run (no payment history was given) and every other check passed; the AP gate abstains')
    // a line with no goods-receipt line abstains for another reason: the flag must never pay it
    const noReceipt = noHistoryBill() as { item_receipts: { line_items: unknown[] }[] }
    noReceipt.item_receipts[0]!.line_items.pop()
    const r2 = go(['ap', '--input', put(d, 'no-receipt.json', noReceipt), '--allow-open'])
    expect(r2.code).toBe(2)
    expect(r2.json()).toMatchObject({ decision: 'abstain', exit: 2, allow_open: 'stated, not applied' })
    expect(r2.err).toContain('--allow-open changes nothing here: the AP gate decided abstain (exit 2). It accepts only a bill held because no payment history was given')
  })

  it('ap --history states the book on the text path: a clean bill with an empty history approves (exit 0); without it, a person decides', () => {
    const d = scratch('ap-history-')
    const clean = put(d, 'clean.txt', readFileSync(join(HERE, 'fixtures', 'data', 'ap-three-way.txt'), 'utf8').replace('Machine grease cartridge 14 oz | received 7', 'Machine grease cartridge 14 oz | received 10'))
    const none = go(['ap', clean])
    expect([none.code, none.json().decision]).toEqual([2, 'abstain'])
    const empty = go(['ap', clean, '--history', put(d, 'history.json', [])])
    expect([empty.code, empty.json().decision, empty.json().payable]).toEqual([0, 'approve', true])
    expect(empty.err.split('\n')[0]).toMatch(/^verify ap: APPROVE · verdict PASS: /)
    const dup = go(['ap', clean, '--history', put(d, 'booked.json', [{ invoice_number: 'AJ-97466', po_number: 'PO-49051', total: 1935.5, vendor: 'Aldine Janitorial' }])])
    expect([dup.code, dup.json().decision]).toEqual([1, 'hold_duplicate'])
    expect(go(['ap', clean, '--history', put(d, 'bad.json', { invoice_number: 'x' })]).err).toMatch(/--history .* must be a JSON array of the invoices already booked/)
    expect(go(['ap', clean, '--history', put(d, 'bad2.json', [{ total: 1 }])]).code).toBe(3)
    expect(go(['ap', clean, '--history', put(d, 'h1.json', []), '--history', put(d, 'h2.json', [])]).code).toBe(3)
    expect(go(['ap', '--input', put(d, 'bill.json', noHistoryBill()), '--history', put(d, 'h3.json', [])]).err).toMatch(/carries its own payment_history/)
    expect(go(['ap', '--help']).err).toContain('--history <history.json>')
  })

  it('apExit: an approve pays only on a clean PASS with payable true; an approve a check could not run on reads A PERSON DECIDES', () => {
    const open = verify(inv.clean, { now: NOW })
    const clean = { ...open, claims: open.claims.filter(c => c.outcome === 'PASS'), gate_status: 'PASS' } as Verdict
    expect(apExit({ decision: 'approve', payable: true, verdict: clean })).toMatchObject({ exit: 0, word: 'APPROVE' })
    if (open.gate_status === 'PASS_WITH_OPEN') {
      expect(apExit({ decision: 'approve', payable: true, verdict: open })).toMatchObject({ exit: 2, word: expect.stringMatching(/^A PERSON DECIDES \(every check that ran passed, but .* could not run\)$/) })
      expect(apExit({ decision: 'approve', payable: true, verdict: open }, true)).toMatchObject({ exit: 0, allow_open: true })
    }
    expect(apExit({ decision: 'approve', payable: false, verdict: clean })).toMatchObject({ exit: 2 })
    expect(apExit({ decision: 'hold_price', payable: false, verdict: clean })).toMatchObject({ exit: 1, word: 'HOLD (hold_price)' })
    expect(apExit({ decision: 'abstain', payable: null, verdict: open })).toMatchObject({ exit: 2 })
    expect(renderGate({ decision: 'approve', payable: false })).toBe('A PERSON DECIDES (gate: approve held, a check could not run)')
    expect(renderGate({ decision: 'approve', payable: true })).toBe('APPROVE (gate: the check pays)')
  })

  it('HTTP: every verdict route carries x-verify-gate and x-verify-exit; "allow_open": true is stated; anything else is a 400', () => {
    const v = verify(inv.clean, { now: NOW })
    const r = route({ method: 'POST', path: '/v1/verify', body: { extraction: inv.clean } })
    expect(r.status).toBe(200)
    expect(r.headers).toEqual(exitHeaders(verdictExit(v)))
    expect((r.json as Verdict).verdict_id).toBe(v.verdict_id) // the body is the verdict, unchanged
    const allowed = route({ method: 'POST', path: '/v1/verify', body: { extraction: inv.clean, allow_open: true } })
    expect((allowed.json as Verdict).verdict_id).toBe(v.verdict_id) // allow_open is not an input: same verdict, same id
    if (v.gate_status === 'PASS_WITH_OPEN') expect(allowed.headers).toMatchObject({ 'x-verify-exit': '0', 'x-verify-allow-open': 'stated' })
    expect(route({ method: 'POST', path: '/v1/verify', body: { extraction: inv.clean, allow_open: 'yes' } })).toMatchObject({ status: 400, json: { error: '"allow_open" must be true or false' } })
    expect(route({ method: 'POST', path: '/v1/verify', body: { extraction: inv.broken } }).headers?.['x-verify-exit']).toBe('1')
    const batch = route({ method: 'POST', path: '/v1/verify/batch', body: { items: [{ extraction: inv.clean }, { extraction: inv.broken }] } })
    expect(batch.headers?.['x-verify-exit']).toBe('1')
  })

  it('MCP: a verdict tool\'s second text item is the gate line; the JSON and structured content are the verdict as before', () => {
    const res = handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'verify_document', arguments: { extraction: inv.clean } } })!
    const result = res.result as { isError: boolean; content: { text: string }[]; structuredContent: Verdict }
    expect(result.isError).toBe(false)
    expect(result.content[0]!.text).toBe(exitLine(verdictExit(result.structuredContent))) // the gate line leads
    expect((JSON.parse(result.content[1]!.text) as Verdict).verdict_id).toBe(result.structuredContent.verdict_id)
    const bad = handleRequest({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'verify_document', arguments: { extraction: inv.clean, allow_open: 1 } } })!
    expect((bad.result as { isError: boolean }).isError).toBe(true)
    const ap = handleRequest({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'verify_invoice_match', arguments: { structured: noHistoryBill() } } })!
    expect((ap.result as { content: { text: string }[] }).content[0]!.text).toMatch(/^gate: A PERSON DECIDES · exit 2 \(do not act on it as passed\)/)
    const apAllowed = handleRequest({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'verify_invoice_match', arguments: { structured: noHistoryBill(), allow_open: true } } })!
    expect((apAllowed.result as { content: { text: string }[] }).content[0]!.text).toMatch(/^gate: A PERSON DECIDES, exit 0 by allow-open · exit 0: exit 0 by allow-open, the caller's stated choice: the duplicate check did not run/)
  })

  it('MCP: the declared tool names the peppol default the CLI resolves (it said 0.2.0 after the default moved), and every carried name', () => {
    const list = handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' })!.result as { tools: { name: string; description: string; inputSchema: { properties: Record<string, any> } }[] }
    const declared = list.tools.find(t => t.name === 'verify_declared')!
    const rs = declared.inputSchema.properties.ruleset
    expect(rs.description).toContain(`A bare "peppol-en16931" (or "e-invoice") is ${carriedDefaultVersion('peppol-en16931')}`)
    expect(rs.description).not.toContain('(= 0.2.0')
    expect(rs.oneOf[1].enum).toEqual(carriedRulesetNames())
    expect(go(['--help', 'all']).err).toContain(`peppol-en16931 = ${carriedDefaultVersion('peppol-en16931')}`)
    for (const t of ['verify_document', 'verify_invoice_match', 'verify_declared']) expect(list.tools.find(x => x.name === t)!.inputSchema.properties.allow_open?.type).toBe('boolean')
  })
})

describe('replay pins an AP verdict\'s gate line to the verdict\'s own engine; this build\'s reading only follows, labelled', () => {
  // A banked loop (a verbatim copy of the receipts package's loop-ap-engine-0.1.0 fixture): two rounds, each an engine-0.1.0 AP
  // verdict with no payment history, each with the gate row the loop recorded when it ran.
  const LOOP = JSON.parse(readFileSync(join(HERE, 'fixtures', 'data', 'loop-ap-engine-0.1.0', 'AP-L-T003.loop.json'), 'utf8')) as {
    rounds: { verify_bundle: { verdict: Verdict; inputs: J } }[]; chain: { body: J }[]
  }
  const recorded = (v: Verdict): J => LOOP.chain.map(c => c.body).find(b => b.verdict_id === v.verdict_id)!
  /** The gate decision a recorded row's action stands for (receipts' loop: EXECUTE pays, REVIEW goes to a person). */
  const decisionOf = (row: J): GateReading => (row.action === 'EXECUTE' ? { decision: 'approve', payable: true } : { decision: 'abstain', payable: null })

  it('the round the loop recorded EXECUTE/PAY replays with the pinned APPROVE line, then "under engine 0.6.0 this would read A PERSON DECIDES"', () => {
    const b = LOOP.rounds[1]!.verify_bundle
    expect(b.verdict.engine_version).toBe('0.1.0')
    const row = recorded(b.verdict)
    expect([row.status, row.action, row.effect]).toEqual(['PASS', 'EXECUTE', 'PAY'])
    const c = replayBundle(b, 'round 2')
    expect(c.result).toBe('MATCH')
    expect(c.gate).toEqual(decisionOf(row)) // pinned: exactly the reading the row recorded
    expect(c.gate_now).toEqual({ engine: ENGINE_VERSION, decision: 'abstain', payable: false }) // this build's stricter reading
    const lines = renderCaseReplay(c).split('\n')
    expect(lines[0]).toContain('APPROVE (gate: the check pays) · verdict PASS')
    expect(lines[1]).toBe(`    under engine ${ENGINE_VERSION} this would read A PERSON DECIDES (gate: a check could not decide)`)
    // the single replay says the same: the pinned line first, the labelled one second
    const d = scratch('pinned-')
    const r = go(['replay', put(d, 'round2.json', b)])
    expect(r.code).toBe(0)
    const err = r.err.split('\n')
    expect(err[1]).toMatch(/^verify replay: APPROVE \(gate: the check pays\) · verdict PASS: /)
    expect(err[2]).toBe(`  under engine ${ENGINE_VERSION} this would read A PERSON DECIDES (gate: a check could not decide)`)
    expect(r.json().gate).toEqual(decisionOf(row))
  })

  it('the round the loop recorded REVIEW replays as A PERSON DECIDES, and no second line when this build reads it the same way', () => {
    const b = LOOP.rounds[0]!.verify_bundle
    const row = recorded(b.verdict)
    expect([row.status, row.action]).toEqual(['PASS-WITH-OPEN', 'REVIEW'])
    const c = replayBundle(b, 'round 1')
    expect([c.result, c.gate?.decision]).toEqual(['MATCH', decisionOf(row).decision])
    expect(c.gate_now).toBeUndefined()
    expect(renderCaseReplay(c)).not.toContain('this would read')
  })
})

describe('strict replay fails on what is wrong, not on what is present', () => {
  const legalBundle = (producer?: string): { verdict: Verdict; inputs: J } => {
    const citations = [{ id: '1', case_name: 'Carlisle v. Example', quote: 'the arbitration clause is unenforceable' }]
    const sources = { 'Carlisle v. Example': 'Carlisle v. Example. The opinion holds that the arbitration clause is unenforceable because it was procured by fraud.' }
    return { verdict: verifyCitations(citations, sources, { now: NOW, ...(producer !== undefined ? { producer } : {}) }) as unknown as Verdict, inputs: { citations, sources } }
  }

  it('a genuine bundle carrying document.producer passes --strict (exit 0) and the label is reported; deleting it changes nothing', () => {
    const d = scratch('strict-')
    const withP = put(d, 'p.json', legalBundle('x2-legal-blind'))
    const r = go(['replay', withP, '--strict'])
    expect(r.code).toBe(0)
    expect(r.json().strict).toMatchObject({ ok: true, problems: [] })
    expect(r.err).toContain('strict note: document.producer "x2-legal-blind" is the issuer\'s label')
    expect(go(['replay', put(d, 'np.json', legalBundle()), '--strict']).code).toBe(0)
    const folder = go(['replay', d, '--strict'])
    expect(folder.code).toBe(0)
    expect(folder.json().cases.find((c: J) => c.name === 'p.json').strict_notes[0]).toMatch(/is the issuer's label/)
  })

  it('a producer that is not what the engine writes (an object) DIVERGES: the label is compared as carried', () => {
    const d = scratch('strict-')
    const b = legalBundle('x2-legal-blind')
    const odd = { ...b, verdict: { ...b.verdict, document: { ...b.verdict.document, producer: { name: 'x' } } } }
    expect(go(['replay', put(d, 'o.json', odd)]).code).toBe(1)
  })

  it('issued_at: malformed is refused with or without --strict (exit 3); missing fails --strict only', () => {
    const d = scratch('strict-')
    const b = legalBundle()
    const lol = put(d, 'lol.json', { ...b, verdict: { ...b.verdict, issued_at: { lol: 1 } } })
    for (const extra of [[], ['--strict']]) {
      const r = go(['replay', lol, ...extra])
      expect(r.code).toBe(3)
      expect(r.err).toMatch(/issued_at is not an ISO-8601 timestamp: \{"lol":1\}/)
    }
    const { issued_at: _drop, ...noTime } = b.verdict
    const missing = put(d, 'missing.json', { ...b, verdict: noTime })
    expect(go(['replay', missing]).code).toBe(0)
    const s = go(['replay', missing, '--strict'])
    expect(s.code).toBe(1)
    expect(s.json().strict.problems).toContain('issued_at is missing: every verdict records when it was issued')
    expect(issuedAtProblem('2026-10-05T16:03:24.839Z')).toBeUndefined()
    expect(issuedAtProblem('2026-10-03T12:00:00Z')).toBeUndefined()
    expect(issuedAtProblem('2026-10-03T12:00:00+05:45')).toBeUndefined()
    for (const bad of ['2026-02-30T00:00:00Z', '2026-10-05T24:00:00Z', '2026-10-05', '2026-10-05T16:03:24', 'yesterday', 1700000000]) expect(issuedAtProblem(bad), String(bad)).toBeDefined()
  })

  it('--trusted-key takes an inline PEM (both forms); the full fingerprint is printed; a 12-character prefix is refused, saying why', () => {
    const d = scratch('pem-')
    const k = generateSigningKeypair()
    const ex = inv.clean
    const env = put(d, 'env.json', signVerdict(verify(ex, { now: NOW }), k.privateKeyPem))
    const exPath = put(d, 'ex.json', ex)
    const inline = go(['replay', env, '--extraction', exPath, '--trusted-key', k.publicKeyPem])
    expect(inline.code).toBe(0)
    expect(go(['replay', env, '--extraction', exPath, `--trusted-key=${k.publicKeyPem}`]).code).toBe(0)
    const fp = /signing key fingerprint ([0-9a-f]{64}) \(the trusted key\)/.exec(inline.err)?.[1]
    expect(fp).toBeDefined()
    expect(go(['replay', env, '--extraction', exPath, '--trusted-key', fp!]).code).toBe(0)
    const unpinned = go(['replay', env, '--extraction', exPath])
    expect(unpinned.err).toContain(`signing key fingerprint ${fp} (to pin it: --trusted-key ${fp})`)
    const prefix = go(['replay', env, '--extraction', exPath, '--trusted-key', fp!.slice(0, 12)])
    expect(prefix.code).toBe(3)
    expect(prefix.err).toMatch(/a fingerprint prefix is not a pin .* pass the full 64-hex fingerprint/)
  })
})

describe('messages: what was typed wrong is said, and the hint can be typed', () => {
  it('a mistyped command, or a verdict handed to check, is refused (exit 3) with the command meant; never a fresh check', () => {
    const d = scratch('msg-')
    const v = verify(inv.clean, { now: NOW })
    const vf = put(d, 'verdict.json', v)
    const typo = go(['replya', vf])
    expect([typo.code, typo.out]).toEqual([3, ''])
    expect(typo.err).toBe(`verify: unknown command "replya" (did you mean replay?) (and no file by that name)\nsee: ${BIN} --help\n`)
    const bare = go([vf])
    expect([bare.code, bare.out]).toEqual([3, ''])
    expect(bare.err).toBe(`verify: ${vf} looks like a verdict (it carries verdict_id, input_hash, ruleset and engine_version), not an extraction.\ndid you mean: ${BIN} replay ${vf}\n`)
    const k = generateSigningKeypair()
    expect(go([put(d, 'env.json', signVerdict(v, k.privateKeyPem))]).err).toMatch(/looks like a signed envelope/)
    expect(go(['check', put(d, 'bundle.json', { verdict: v, inputs: {} })]).err).toMatch(/looks like a replay bundle/)
    const two = go([put(d, 'a.json', inv.clean), put(d, 'b.json', inv.clean)])
    expect([two.code, two.err.split('\n')[0]]).toEqual([3, expect.stringMatching(/^verify: one extraction per call \(got .*a\.json, .*b\.json\)$/)])
  })

  it('a mistyped --ruleset names the known rulesets; a --source that is not a file says it takes a file path (check and replay)', () => {
    const d = scratch('msg-')
    const f = put(d, 'clean.json', inv.clean)
    const rs = go([f, '--ruleset', 'peppol-en1693'])
    expect(rs.code).toBe(3)
    expect(rs.err.split('\n')[0]).toBe(`verify: no ruleset named "peppol-en1693" (did you mean peppol-en16931?); known: ${['invoice', 'pay-app', ...carriedRulesetNames()].join(', ')}; or the path of a ruleset JSON file`)
    const src = go([f, '--source', 'some text'])
    expect(src.code).toBe(3)
    expect(src.err.split('\n')[0]).toBe('verify: --source takes a file path (the source document\'s text, read as UTF-8); there is no file named "some text"')
    const rep = go(['replay', join(N18, 'peppol-N18.json'), '--extraction', join(N18, 'peppol-N18.extraction.json'), '--ruleset', RS_V02, '--source', 'some text'])
    expect(rep.code).toBe(3)
    expect(rep.err).toMatch(/--source takes a file path/)
  })

  it('the suite writes scratch inside the package: os.tmpdir() resolves under <package>/tmp/vitest (vitest.config.ts)', () => {
    const inside = resolve(HERE, '..', 'tmp', 'vitest')
    expect(resolve(tmpdir()).startsWith(inside), `os.tmpdir() is ${tmpdir()}`).toBe(true)
    for (const k of ['TMPDIR', 'TMP', 'TEMP']) expect(resolve(process.env[k] ?? ''), k).toBe(resolve(tmpdir()))
  })

  it('the hint names a command the reader can type: node <path> in a checkout, npx tsx for the source, the bin when installed', () => {
    expect(invokedAs('/work/repo/packages/verify/dist/cli.js', '/work/repo')).toBe('node packages/verify/dist/cli.js')
    if (process.platform === 'win32') expect(invokedAs('C:\\work\\repo\\packages\\verify\\dist\\cli.js', 'C:\\work\\repo')).toBe('node packages/verify/dist/cli.js')
    expect(invokedAs('/work/my repo/dist/cli.js', '/elsewhere')).toBe('node "../work/my repo/dist/cli.js"')
    expect(invokedAs('/work/repo/packages/verify/src/cli.ts', '/work/repo/packages/verify')).toBe('npx tsx src/cli.ts')
    expect(invokedAs('/usr/lib/node_modules/x/dist/cli.js', '/home/u')).toBe(BIN)
    expect(invokedAs('/usr/local/bin/some-bin', '/home/u')).toBe(BIN)
    expect(invokedAs(undefined, '/home/u')).toBe(BIN)
  })
})
