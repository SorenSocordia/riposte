import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ENGINE_VERSION, generateSigningKeypair, PEPPOL_EN16931_V0_2_0, verifyInvoiceMatch, type DeclarativeRuleset } from 'riposte-verify'
import {
  openLoop, verifyLoopBundle, editDiscipline, declarativeScope, quoteReadsAs, flattenPaths, remedyId, canonicalSha256, replayRoundInProcess, loopCli,
  type ApTextProposal, type DeclarativeProposal, type LoopBundle, type AgentModel, type LoopTask,
} from '../src/index.js'

const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex')
const NOW = () => new Date('2026-10-03T12:00:00Z')
const STAND_IN: AgentModel = { model: null, evidence_tier: 'none', program: 'test-standin@1' }
const { privateKeyPem, publicKeyPem } = generateSigningKeypair()

// --- a synthetic AP case (written for this test; not from any benchmark) ---------------------------------------------------
const INVOICE = 'INVOICE MESSAGE\nFrom: ar@examplevendor.test\nSubject: Example Vendor invoice EV-10001\n\nPlease find our invoice EV-10001 against your order PO-70001:\n\n- 4 x WIDGET BOX @ USD 10.00 = USD 40.00\n- 2 x GADGET @ USD 25.00 = USD 50.00\n\nTotal due: USD 90.00\n'
const erpRecord = (received: number): string => 'PURCHASE ORDER (ERP)\nPO-70001 | Vendor: Example Vendor | Freight: not allowed\n1. Widget box | qty 4 | unit USD 10.00\n2. Gadget | qty 2 | unit USD 25.00\n\n' +
  `GOODS RECEIPT (ERP) for PO-70001\n1. Widget box | received ${received}\n2. Gadget | received 2`
const part = (rec: string, k: 'purchase_order' | 'goods_receipt'): string => {
  const i = rec.indexOf('GOODS RECEIPT (ERP)')
  return k === 'purchase_order' ? rec.slice(0, i) : rec.slice(i)
}
// engine 0.6.0: the books are known and empty, so the duplicate check runs (without them an approve is PASS-WITH-OPEN and never pays)
const apTask: LoopTask = { kind: 'ap-text', item_id: 'EV-10001', input_sha256: sha(INVOICE), history: [] }
function apRound1(rec: string): ApTextProposal {
  return { kind: 'ap-text', decision: 'approve', documents: { invoice: INVOICE, purchase_order: part(rec, 'purchase_order'), goods_receipt: '' },
    supplied_from: { purchase_order: { source: 'erp', key: 'EV-10001', record_sha256: sha(rec), part: 'purchase_order' } } }
}
const supplyGr = (p: ApTextProposal, rec: string): ApTextProposal => ({ ...p, documents: { ...p.documents, goods_receipt: part(rec, 'goods_receipt') },
  supplied_from: { ...p.supplied_from, goods_receipt: { source: 'erp', key: 'EV-10001', record_sha256: sha(rec), part: 'goods_receipt' } } })

// --- a synthetic Peppol-shaped invoice ----------------------------------------------------------------------------------------
const RS = PEPPOL_EN16931_V0_2_0 as unknown as DeclarativeRuleset
const BASE = { invoice_number: 'A-1', issue_date: '2026-01-02', currency: 'EUR', amount_currency: 'EUR', line_extension_amount: 100, tax_exclusive_amount: 100, tax_amount: 20,
  tax_inclusive_amount: 120, payable_amount: 120, lines: [{ id: '1', invoiced_quantity: 1, price_amount: 100, line_extension_amount: 100 }], vat_breakdown: [{ category: 'S', rate: 20, taxable_amount: 100, tax_amount: 20, row: 1 }] }
const TEXT = ['Invoice number: A-1', 'Issue date: 2026-01-02', 'Currency: EUR', 'Sum of line net amounts EUR 100.00', 'Total without VAT E l00.0O', 'VAT total EUR 20.00', 'Total with VAT EUR 120.00', 'Amount due for payment EUR 120.00'].join('\n')
const declTask: LoopTask = { kind: 'declarative', item_id: 'A-1', input_sha256: sha(TEXT), ruleset: RS }
function unreadableExcl(): DeclarativeProposal {
  const { tax_exclusive_amount: _x, ...rest } = BASE
  return { kind: 'declarative', decision: 'accept', extraction: rest, source: { text: TEXT, quotes: [{ id: 'payable_amount', quote: '120.00' }] } }
}

const replay = (b: LoopBundle) => verifyLoopBundle(b, { replayRound: replayRoundInProcess, policy: { publicKey: publicKeyPem, requireSigned: true } })

describe('closed loop: AP, the agent supplies what the remedy names', () => {
  it('approve with no goods receipt → the remedy names it → supplied → PAY in round 2; the bundle replays', async () => {
    const rec = erpRecord(4)
    const loop = openLoop(apTask, { id: 'test-standin' }, { signingKey: privateKeyPem, now: NOW, loopId: 'ap-1', structuredSources: { 'erp:EV-10001': rec } })
    const r1 = loop.submit(apRound1(rec), STAND_IN)
    expect(r1.gate?.action).toBe('REVIEW')
    expect(r1.instruction?.remedies.map((r) => r.operand?.source)).toContain('goods_receipt')
    // the instruction carries the verdict's remedies byte for byte, and says it in words
    expect(JSON.stringify(r1.instruction!.remedies)).toBe(JSON.stringify(r1.gate!.bundle.verdict.remedies))
    expect(r1.instruction!.text).toMatch(/Round 1 of 3: not executed/)
    expect(r1.instruction!.text).toMatch(/\[missing-operand\] goods_receipt/)
    const r2 = loop.submit(supplyGr(apRound1(rec), rec), STAND_IN)
    expect(r2.closed).toMatchObject({ outcome: 'CONVERGED-PASS', rounds_used: 2 })
    const b = loop.bundle()
    expect(b.chain.map((e) => e.kind)).toEqual(['loop.open', 'loop.proposal', 'loop.verdict', 'loop.remedy_returned', 'loop.proposal', 'loop.verdict', 'loop.close'])
    expect(b.top_hash).toBe(b.chain.at(-1)!.hash)
    expect(b.rounds[1]!.discipline).toMatchObject({ ok: true, changed: ['goods_receipt'], scope: ['goods_receipt'] })
    const c = await replay(b)
    expect(c.problems).toEqual([])
    expect(c).toMatchObject({ ok: true, outcome: 'CONVERGED-PASS', rounds_used: 2 })
    expect(c.rounds.map((r) => r.replay?.result)).toEqual(['MATCH', 'MATCH'])
  })

  it('a short receipt: supplied → the check FAILs → the agent concedes → HOLD executes (CONVERGED-FAIL in 3)', async () => {
    const rec = erpRecord(3)
    const loop = openLoop(apTask, { id: 'test-standin' }, { signingKey: privateKeyPem, now: NOW, structuredSources: { 'erp:EV-10001': rec } })
    loop.submit(apRound1(rec), STAND_IN)
    const r2 = loop.submit(supplyGr(apRound1(rec), rec), STAND_IN)
    expect(r2.gate?.bundle.verdict.outcome).toBe('FAIL')
    expect(r2.instruction?.rounds_left).toBe(1)
    const r3 = loop.submit({ ...supplyGr(apRound1(rec), rec), decision: 'hold' }, STAND_IN)
    expect(r3.closed).toMatchObject({ outcome: 'CONVERGED-FAIL', rounds_used: 3 })
    expect((await replay(loop.bundle())).ok).toBe(true)
  })

  it('the round limit holds for a person; a decline holds too', async () => {
    const rec = erpRecord(3)
    const loop = openLoop(apTask, { id: 'stubborn' }, { signingKey: privateKeyPem, now: NOW, structuredSources: { 'erp:EV-10001': rec } })
    loop.submit(apRound1(rec), STAND_IN)
    loop.submit(supplyGr(apRound1(rec), rec), STAND_IN)
    const r3 = loop.submit(supplyGr(apRound1(rec), rec), STAND_IN) // still "approve": the gate still disagrees
    expect(r3.closed?.outcome).toBe('HELD-FOR-HUMAN')
    expect(r3.closed?.reason).toMatch(/round limit 3/)
    expect(r3.instruction).toBeUndefined()
    expect(() => loop.submit(apRound1(rec), STAND_IN)).toThrow(/closed/)
    expect((await replay(loop.bundle())).ok).toBe(true)
    const d = openLoop(apTask, { id: 'shy' }, { signingKey: privateKeyPem, now: NOW, structuredSources: { 'erp:EV-10001': rec } })
    d.submit(apRound1(rec), STAND_IN)
    expect(d.decline('no lawful action', STAND_IN)).toMatchObject({ outcome: 'HELD-FOR-HUMAN', rounds_used: 1 })
    expect((await replay(d.bundle())).ok).toBe(true)
  })

  it('the discipline refuses a document no remedy named, and one supplied without its source', () => {
    const rec = erpRecord(4)
    const loop = openLoop(apTask, { id: 'x' }, { now: NOW, structuredSources: { 'erp:EV-10001': rec } })
    loop.submit(apRound1(rec), STAND_IN)
    const swapped = supplyGr(apRound1(rec), rec)
    swapped.documents.purchase_order = swapped.documents.purchase_order.replace('unit USD 25.00', 'unit USD 26.00')
    const r = loop.submit(swapped, STAND_IN)
    expect(r.refused?.out_of_scope).toEqual(['purchase_order'])
    expect(r.closed?.outcome).toBe('HELD-FOR-HUMAN')
    expect(r.gate).toBeUndefined()
    const l2 = openLoop(apTask, { id: 'x' }, { now: NOW, structuredSources: { 'erp:EV-10001': rec } })
    l2.submit(apRound1(rec), STAND_IN)
    const unsourced = supplyGr(apRound1(rec), rec)
    delete unsourced.supplied_from!.goods_receipt
    expect(l2.submit(unsourced, STAND_IN).refused?.unproven).toEqual([{ path: 'goods_receipt', reason: 'supplied without naming its source' }])
    const l3 = openLoop(apTask, { id: 'x' }, { now: NOW, structuredSources: { 'erp:EV-10001': rec } })
    l3.submit(apRound1(rec), STAND_IN)
    const forged = supplyGr(apRound1(rec), rec)
    forged.documents.goods_receipt = forged.documents.goods_receipt.replace('received 4', 'received 9')
    expect(l3.submit(forged, STAND_IN).refused?.unproven[0]?.reason).toMatch(/not the goods_receipt part/)
  })
})

describe('closed loop: a declarative document (Peppol 0.2.0)', () => {
  it('an unreadable total → missing-operand → re-read with a quote on an appended page → PASS in round 2', async () => {
    const loop = openLoop(declTask, { id: 'test-standin' }, { signingKey: privateKeyPem, now: NOW })
    const r1 = loop.submit(unreadableExcl(), STAND_IN)
    // 2026-10-04: the loop reads verify's gateStatusOpen. Under the current engine this total is a struck load-bearing
    // field, so the round reads OPEN (it read PASS-WITH-OPEN under gateStatus). Both hold; the remedies and round 2 are unchanged.
    expect(r1.gate?.status).toBe('OPEN')
    expect(r1.instruction?.text).toMatch(/\(gate: OPEN\)/)
    expect(r1.instruction?.remedies.some((r) => r.kind === 'missing-operand' && r.operand?.role === 'TAX_EXCL')).toBe(true)
    const p2 = unreadableExcl()
    p2.extraction.tax_exclusive_amount = 100
    p2.source = { text: `${TEXT}\fTotal without VAT EUR 100.00`, quotes: [...p2.source!.quotes!, { id: 'tax_exclusive_amount', quote: 'Total without VAT EUR 100.00' }] }
    const r2 = loop.submit(p2, STAND_IN)
    expect(r2.closed).toMatchObject({ outcome: 'CONVERGED-PASS', rounds_used: 2 })
    const c = await replay(loop.bundle())
    expect(c.problems).toEqual([])
  })

  it('the brief\'s naive "recompute" (set the stated field to the expected figure, keep the old quote) is refused; with the discipline off it PASSes', async () => {
    const wrong: DeclarativeProposal = { kind: 'declarative', decision: 'accept', extraction: { ...BASE, payable_amount: 130 }, source: { text: TEXT.replace('payment EUR 120.00', 'payment EUR 130.00'), quotes: [{ id: 'payable_amount', quote: '130.00' }] } }
    const naive = (r1Expected: number): DeclarativeProposal => ({ ...wrong, extraction: { ...wrong.extraction, payable_amount: r1Expected } })
    for (const discipline of [true, false]) {
      const loop = openLoop({ ...declTask, item_id: 'A-2' }, { id: 'naive' }, { signingKey: privateKeyPem, now: NOW, discipline })
      const r1 = loop.submit(wrong, STAND_IN)
      expect(r1.gate?.bundle.verdict.outcome).toBe('FAIL')
      const claim = r1.gate!.bundle.verdict.claims.find((c) => c.claim_id === 'document.PAYABLE_INT')!
      const r2 = loop.submit(naive(Number(claim.computation?.result)), STAND_IN)
      if (discipline) {
        expect(r2.refused?.unproven).toEqual([{ path: 'payable_amount', reason: 'its quote "130.00" does not read as 120' }])
        expect(r2.closed?.outcome).toBe('HELD-FOR-HUMAN')
      } else {
        expect(r2.closed?.outcome).toBe('CONVERGED-PASS') // the hole the discipline closes: a printed 130.00 "re-read" as 120
      }
      const c = await replay(loop.bundle())
      expect(c.ok).toBe(true)
    }
  })

  it('a confirmed FAIL: the agent concedes (reject) and the gate executes it', async () => {
    const wrong: DeclarativeProposal = { kind: 'declarative', decision: 'accept', extraction: { ...BASE, payable_amount: 130 }, source: { text: TEXT, quotes: [] } }
    const loop = openLoop(declTask, { id: 'test-standin' }, { signingKey: privateKeyPem, now: NOW })
    loop.submit(wrong, STAND_IN)
    const r2 = loop.submit({ ...wrong, decision: 'reject' }, STAND_IN)
    expect(r2.closed).toMatchObject({ outcome: 'CONVERGED-FAIL', rounds_used: 2 })
    expect((await replay(loop.bundle())).ok).toBe(true)
  })

  it('out of scope, and a rewritten source, are refused', () => {
    const wrong: DeclarativeProposal = { kind: 'declarative', decision: 'accept', extraction: { ...BASE, payable_amount: 130 }, source: { text: TEXT, quotes: [] } }
    const l1 = openLoop(declTask, { id: 'x' }, { now: NOW })
    l1.submit(wrong, STAND_IN)
    expect(l1.submit({ ...wrong, extraction: { ...wrong.extraction, invoice_number: 'A-9' }, source: { text: `${TEXT}\fInvoice number: A-9`, quotes: [{ id: 'invoice_number', quote: 'A-9' }] } }, STAND_IN).refused?.out_of_scope).toEqual(['invoice_number'])
    const l2 = openLoop(declTask, { id: 'x' }, { now: NOW })
    l2.submit(wrong, STAND_IN)
    const r = l2.submit({ ...wrong, extraction: { ...wrong.extraction, payable_amount: 120 }, source: { text: TEXT.replace('120.00\n', 'x').replace('payment EUR 120.00', 'payment EUR 120.00'), quotes: [{ id: 'payable_amount', quote: 'payment EUR 120.00' }] } }, STAND_IN)
    expect(r.refused?.source_rewritten).toBe(true)
  })

  it('scope: the operands of every claim a remedy answers, at that line; a seller remedy opens nothing', () => {
    const fail = { kind: 'recompute-with' as const, operand: { source: 'e-invoice', role: 'LINE_EXT', path: 'lines[0].line_extension_amount' }, detail: 'x', clears: ['LINE_MATH_INT'], claims: ['line[0].LINE_MATH_INT'] }
    const s = declarativeScope(RS, [fail, { kind: 'missing-operand', operand: { source: 'seller', path: 'corrected invoice' }, detail: 'y', clears: ['LINE_MATH_INT'], claims: ['line[0].LINE_MATH_INT'] }])
    expect(s).toContain('lines[0].price_amount')
    expect(s).toContain('lines[0].invoiced_quantity')
    expect(s).not.toContain('lines[1].price_amount')
    expect(s).not.toContain('corrected invoice')
    const sum = declarativeScope(RS, [{ kind: 'recompute-with', operand: { source: 'e-invoice', role: 'SUM_LINE_NET', path: 'sum_of_line_net_amount' }, detail: 'z', clears: ['LINES_SUM_INT'], claims: ['document.LINES_SUM_INT'] }])
    expect(sum).toContain('lines[*].line_extension_amount')
    const d = editDiscipline({ ...declTask }, { kind: 'declarative', decision: 'accept', extraction: BASE, source: { text: TEXT } },
      { kind: 'declarative', decision: 'accept', extraction: { ...BASE, lines: [{ ...BASE.lines[0]!, line_extension_amount: 101 }] }, source: { text: `${TEXT}\f1 item 1 100.00 101.00`, quotes: [{ id: 'lines[0].line_extension_amount', quote: '1 item 1 100.00 101.00' }] } },
      [{ kind: 'recompute-with', operand: { source: 'e-invoice', role: 'SUM_LINE_NET', path: 'sum_of_line_net_amount' }, detail: 'z', clears: ['LINES_SUM_INT'], claims: ['document.LINES_SUM_INT'] }])
    expect(d).toMatchObject({ ok: true, changed: ['lines[0].line_extension_amount'], out_of_scope: [] })
  })

  it('quotes read as their value under either decimal convention, strictly', () => {
    expect(quoteReadsAs('Amount due EUR 8,350.00', 8350)).toBe(true)
    expect(quoteReadsAs('Zahlbetrag 8.350,00', 8350)).toBe(true)
    expect(quoteReadsAs('EUR8,350.00', 8350)).toBe(true)
    expect(quoteReadsAs('8,350.00', 8250)).toBe(false)
    expect(quoteReadsAs('°225.0', 225)).toBe(false)
    expect(quoteReadsAs('1,2?5.00', 12)).toBe(false)
    expect(quoteReadsAs('Currency: EUR', 'EUR')).toBe(true)
    expect([...flattenPaths({ a: 1, l: [{ x: 2 }], v: [] }).keys()]).toEqual(['a', 'l[0].x', 'v'])
  })
})

describe('closed loop: tampering is named by round', () => {
  async function aBundle(): Promise<LoopBundle> {
    const rec = erpRecord(3)
    const loop = openLoop(apTask, { id: 'test-standin' }, { signingKey: privateKeyPem, now: NOW, loopId: 'tamper', structuredSources: { 'erp:EV-10001': rec } })
    loop.submit(apRound1(rec), STAND_IN)
    loop.submit(supplyGr(apRound1(rec), rec), STAND_IN)
    loop.submit({ ...supplyGr(apRound1(rec), rec), decision: 'hold' }, STAND_IN)
    const b = loop.bundle()
    expect((await replay(b)).ok).toBe(true)
    return b
  }

  it('one byte of a returned remedy', async () => {
    const b = await aBundle()
    const r = b.rounds[1]!.instruction!.remedies[0]!
    r.detail = r.detail.replace(/.$/, (c) => (c === '.' ? ',' : '.'))
    const c = await replay(b)
    expect(c.ok).toBe(false)
    expect(c.problems.filter((p) => p.round === 2).map((p) => p.field)).toEqual(expect.arrayContaining(['instruction', 'instruction.remedies']))
  })

  it('a proposal value', async () => {
    const b = await aBundle()
    ;(b.rounds[0]!.proposal as ApTextProposal).decision = 'hold_price'
    const c = await replay(b)
    expect(c.problems.some((p) => p.round === 1 && p.field === 'proposal')).toBe(true)
  })

  it('a removed row, a forged top hash, and a re-signed chain under the wrong key', async () => {
    const b = await aBundle()
    const cut = { ...b, chain: b.chain.filter((e) => e.kind !== 'loop.remedy_returned' || (e.body as { round: number }).round !== 1) }
    const c = await replay(cut)
    expect(c.problems.some((p) => p.field === 'chain')).toBe(true)
    expect(c.problems.some((p) => p.round === 1 && p.field === 'loop.remedy_returned')).toBe(true)
    const forged = await replay({ ...(await aBundle()), top_hash: '0'.repeat(64) })
    expect(forged.problems.map((p) => p.field)).toContain('top_hash')
    const other = generateSigningKeypair()
    const wrongKey = await verifyLoopBundle(await aBundle(), { replayRound: replayRoundInProcess, policy: { publicKey: other.publicKeyPem } })
    expect(wrongKey.chain.ok).toBe(false)
  })

  it('a verify bundle whose verdict was edited fails its replay at that round', async () => {
    const b = await aBundle()
    b.rounds[1]!.verify_bundle!.verdict.outcome = 'PASS'
    const c = await replay(b)
    expect(c.rounds[1]!.replay?.result).not.toBe('MATCH')
    expect(c.problems.some((p) => p.round === 2 && p.field === 'verify_bundle')).toBe(true)
  })

  it('remedy ids are content addresses; canonical hashes are stable', () => {
    const r = { kind: 'none' as const, detail: 'the finding stands', clears: ['X'], claims: ['document.X'] }
    expect(remedyId(r)).toBe(canonicalSha256(r).slice(0, 16))
    expect(remedyId({ ...r })).toBe(remedyId(r))
  })
})

// 2026-10-05: a loop banked under an earlier engine replays under this build. The fixture is an AP loop issued under engine
// 0.1.0 (a closed-loop run of 2026-10-03, copied byte for byte with its run's public key): round 1 PASS-WITH-OPEN / REVIEW,
// round 2 PASS / EXECUTE / PAY, with no payment history (before engine 0.6.0, no history did not open the duplicate check).
describe('a banked loop replays under the engine its rows name, never this build\'s default', () => {
  const FX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'loop-ap-engine-0.1.0')
  const banked = (): LoopBundle => JSON.parse(readFileSync(join(FX, 'AP-L-T003.loop.json'), 'utf8')) as LoopBundle
  const key = readFileSync(join(FX, 'run-key.pub.txt'), 'utf8')
  it('an engine-0.1.0 AP loop with no history replays OK under this build: the gate re-derives under 0.1.0, so its PAY stands', async () => {
    const b = banked()
    expect(b.task.history).toBeUndefined()
    const rows = b.chain.filter((e) => e.kind === 'loop.verdict').map((e) => e.body as Record<string, unknown>)
    expect(rows.map((r) => [r.engine_version, r.status, r.action, r.effect])).toEqual([['0.1.0', 'PASS-WITH-OPEN', 'REVIEW', 'HUMAN_REVIEW'], ['0.1.0', 'PASS', 'EXECUTE', 'PAY']])
    expect(ENGINE_VERSION).not.toBe('0.1.0') // the build re-deriving is a later engine
    const c = await verifyLoopBundle(b, { replayRound: replayRoundInProcess, policy: { publicKey: key, requireSigned: true } })
    expect(c.problems).toEqual([])
    expect(c).toMatchObject({ ok: true, outcome: 'CONVERGED-PASS', rounds_used: 2 })
    expect(c.rounds.map((r) => r.replay?.result)).toEqual(['MATCH', 'MATCH'])
  })
  it('a row whose recorded reading is not what its engine gives is refused, and the problem names the engine', async () => {
    const b = banked()
    const v = b.chain.find((e) => e.kind === 'loop.verdict' && (e.body as { round?: number }).round === 2)!
    ;(v.body as Record<string, unknown>).status = 'FAIL'
    const c = await verifyLoopBundle(b, { replayRound: replayRoundInProcess })
    expect(c.problems.some((p) => p.round === 2 && p.field === 'gate' && /re-derives under engine 0\.1\.0 as PASS\/EXECUTE\/PAY; the row says FAIL/.test(p.reason))).toBe(true)
  })
})

/**
 * The two tests below load the engine's built files into this run and start the engine's own command line in a separate
 * process. On a quiet machine each takes a few seconds; on a stranger's machine that is running the other packages' suites at the
 * same time it took 61.9 s once, past the suite's 60 s limit (2026-10-06, cold review round 6). Their rounds already go to one
 * command-line call, so the time is loading and starting, not checking: each gets 180 s.
 */
const CLI_TEST_MS = 180_000

describe('riposte-loop replay (CLI)', () => {
  it('replays a bundle file, rounds through an injected replayer; usage errors exit 3', async () => {
    const rec = erpRecord(4)
    const loop = openLoop(apTask, { id: 'test-standin' }, { signingKey: privateKeyPem, now: NOW, structuredSources: { 'erp:EV-10001': rec } })
    loop.submit(apRound1(rec), STAND_IN)
    loop.submit(supplyGr(apRound1(rec), rec), STAND_IN)
    const files: Record<string, string> = { 'b.json': JSON.stringify(loop.bundle()), 'k.pem': publicKeyPem }
    const io = { readFile: (p: string) => { if (!(p in files)) throw new Error('ENOENT'); return files[p]! }, replayRound: replayRoundInProcess }
    const ok = await loopCli(['replay', 'b.json', '--public-key', 'k.pem', '--require-signed'], io)
    expect(ok.code).toBe(0)
    expect(ok.err).toMatch(/round 1: MATCH\nround 2: MATCH\nriposte-loop replay: OK/)
    expect((await loopCli(['replay'], io)).code).toBe(3)
    expect((await loopCli(['replay', 'missing.json'], io)).code).toBe(3)
    expect((await loopCli(['nope'], io)).code).toBe(3)
  })

  it('a folder: every bundle checked, problems named by file and round', async () => {
    const rec = erpRecord(4)
    const mk = (id: string): LoopBundle => {
      const l = openLoop(apTask, { id: 'test-standin' }, { signingKey: privateKeyPem, now: NOW, loopId: id, structuredSources: { 'erp:EV-10001': rec } })
      l.submit(apRound1(rec), STAND_IN)
      l.submit(supplyGr(apRound1(rec), rec), STAND_IN)
      return l.bundle()
    }
    const bad = mk('b2')
    bad.rounds[0]!.instruction!.remedies[0]!.detail += '!'
    const files: Record<string, string> = { 'd/a.json': JSON.stringify(mk('a1')), 'd/b.json': JSON.stringify(bad), 'd/summary.jsonl': '{}' }
    const io = { readFile: (p: string) => files[p]!, listDir: (p: string) => (p === 'd' ? ['a.json', 'b.json', 'summary.jsonl'] : undefined), join: (d: string, n: string) => `${d}/${n}`, replayRound: replayRoundInProcess }
    const r = await loopCli(['replay', 'd'], io)
    expect(r.code).toBe(1)
    expect(JSON.parse(r.out)).toMatchObject({ total: 2, ok: 1, problems: 1, rounds: 4, rounds_matched: 4, rounds_refused_not_gated: 0 })
    expect(r.err).toMatch(/d\/b\.json: round 1: MATCH · \d problem\(s\): instruction/)
  })

  it('replayRoundsWithCli: one verify CLI call for many rounds, in order (bundles built with verify\'s dist)', async () => {
    const { replayRoundsWithCli, defaultVerifyCli } = await import('../src/loop-command.js')
    const dist = await import('../../verify/dist/index.js') as unknown as { verifyInvoiceMatch: typeof verifyInvoiceMatch }
    const policy = { price_tolerance: 0.02, total_tolerance: 0.005 }
    const mk = (n: number) => {
      const rec = erpRecord(n)
      const docs = { invoice: INVOICE, purchase_order: part(rec, 'purchase_order'), goods_receipt: part(rec, 'goods_receipt') }
      return { verdict: dist.verifyInvoiceMatch(docs, { policy }).verdict, inputs: { ap: docs, policy } }
    }
    const b = [mk(4), mk(3), mk(2)]
    const edited = structuredClone(b[1]!)
    edited.verdict.claims[0]!.explanation = 'edited'
    const r = replayRoundsWithCli([b[0]!, edited, b[2]!], defaultVerifyCli())
    expect(r.map((x) => x.result)).toEqual(['MATCH', 'DIVERGED', 'MATCH'])
  }, CLI_TEST_MS)

  it('replayRoundWithCli: verify\'s own CLI re-performs a round (bundle built with verify\'s dist, which that CLI runs)', async () => {
    const { replayRoundWithCli, defaultVerifyCli } = await import('../src/loop-command.js')
    const dist = await import('../../verify/dist/index.js') as unknown as { verifyInvoiceMatch: typeof verifyInvoiceMatch }
    const rec = erpRecord(4)
    const docs = { invoice: INVOICE, purchase_order: part(rec, 'purchase_order'), goods_receipt: part(rec, 'goods_receipt') }
    const policy = { price_tolerance: 0.02, total_tolerance: 0.005 }
    const v = dist.verifyInvoiceMatch(docs, { policy }).verdict
    expect(replayRoundWithCli({ verdict: v, inputs: { ap: docs, policy } }, 1, defaultVerifyCli())).toMatchObject({ result: 'MATCH' })
    const bad = structuredClone(v)
    bad.claims[0]!.explanation = 'edited'
    expect(replayRoundWithCli({ verdict: bad, inputs: { ap: docs, policy } }, 1, defaultVerifyCli()).result).toBe('DIVERGED')
  }, CLI_TEST_MS)
})
