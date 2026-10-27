import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { generateSigningKeypair, PEPPOL_EN16931_V0_2_0, type DeclarativeRuleset } from 'riposte-verify'
import { verifyLoopBundle, replayRoundInProcess, type DeclarativeProposal, type LoopBundle } from 'riposte-ai'
import { runLoop, apStandIn, recordedThenStandIn, rereadStandIn, naiveRecompute, erpKeyFor, setPath, loopRunCli, type Reading } from '../src/index.js'

const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex')
const { privateKeyPem, publicKeyPem } = generateSigningKeypair()
const replay = (b: LoopBundle) => verifyLoopBundle(b, { replayRound: replayRoundInProcess, policy: { publicKey: publicKeyPem, requireSigned: true } })

// synthetic AP (written for this test)
// 2026-10-06: the AP check no longer takes a subject line as vendor evidence (the sender writes it); the bill comes from an
// address at the vendor's own domain, as the receipts package's loop fixture does
const INVOICE = 'From: ar@examplevendor.test\nSubject: Example Vendor invoice EV-10001\n\nPlease find our invoice EV-10001 against your order PO-70001:\n\n- 4 x WIDGET BOX @ USD 10.00 = USD 40.00\n- 2 x GADGET @ USD 25.00 = USD 50.00\n\nTotal due: USD 90.00\n'
const rec = (received: number): string => 'PURCHASE ORDER (ERP)\nPO-70001 | Vendor: Example Vendor | Freight: not allowed\n1. Widget box | qty 4 | unit USD 10.00\n2. Gadget | qty 2 | unit USD 25.00\n\n' +
  `GOODS RECEIPT (ERP) for PO-70001\n1. Widget box | received ${received}\n2. Gadget | received 2`
// engine 0.6.0: the books are known and empty, so the duplicate check runs (without them an approve never pays)
const apTask = { kind: 'ap-text' as const, item_id: 'EV-10001', input_sha256: sha(INVOICE), history: [] }

// synthetic Peppol-shaped invoice
const RS = PEPPOL_EN16931_V0_2_0 as unknown as DeclarativeRuleset
const BASE = { invoice_number: 'A-1', issue_date: '2026-01-02', currency: 'EUR', amount_currency: 'EUR', line_extension_amount: 100, tax_exclusive_amount: 100, tax_amount: 20,
  tax_inclusive_amount: 120, payable_amount: 120, lines: [{ id: '1', invoiced_quantity: 1, price_amount: 100, line_extension_amount: 100 }], vat_breakdown: [{ category: 'S', rate: 20, taxable_amount: 100, tax_amount: 20, row: 1 }] }
const TEXT = 'Invoice number: A-1\nSum of line net amounts EUR 100.00\nTotal without VAT E l00.0O\nVAT total EUR 20.00\nTotal with VAT EUR 120.00\nAmount due for payment EUR 120.00'
const declTask = { kind: 'declarative' as const, item_id: 'A-1', input_sha256: sha(TEXT), ruleset: RS }
const reading = (name: string, values: Record<string, unknown>, quotes: Record<string, string>, text: string): Reading => ({ name, text, values, quotes })
const flatBase = { invoice_number: 'A-1', line_extension_amount: 100, tax_amount: 20, tax_inclusive_amount: 120, payable_amount: 120, 'lines[0].line_extension_amount': 100, 'lines[0].invoiced_quantity': 1, 'lines[0].price_amount': 100 }

describe('the AP stand-in through the loop', () => {
  it('finds its structured-source key only when exactly one appears in the invoice', () => {
    expect(erpKeyFor(INVOICE, { 'EV-10001': 'x', 'EV-99999': 'y' })).toBe('EV-10001')
    expect(erpKeyFor(INVOICE, { 'EV-10001': 'x', 'PO-70001': 'y' })).toBeUndefined()
    expect(erpKeyFor(INVOICE, {})).toBeUndefined()
  })

  it('pays in round 2 after supplying the goods receipt the remedy names; holds in round 3 on a short receipt', async () => {
    const ok = await runLoop(apTask, apStandIn(INVOICE, { 'EV-10001': rec(4) }), { signingKey: privateKeyPem, structuredSources: { 'erp:EV-10001': rec(4) } })
    expect(ok.closed).toMatchObject({ outcome: 'CONVERGED-PASS', rounds_used: 2 })
    expect(ok.bundle.rounds.map((r) => r.agent)).toEqual([{ model: null, evidence_tier: 'none', program: 't3-standin-ap@1' }, { model: null, evidence_tier: 'none', program: 't3-standin-ap@1' }])
    expect((await replay(ok.bundle)).problems).toEqual([])
    const short = await runLoop(apTask, apStandIn(INVOICE, { 'EV-10001': rec(3) }), { signingKey: privateKeyPem, structuredSources: { 'erp:EV-10001': rec(3) } })
    expect(short.closed).toMatchObject({ outcome: 'CONVERGED-FAIL', rounds_used: 3 })
    expect(short.bundle.rounds.map((r) => r.proposal.decision)).toEqual(['approve', 'approve', 'hold'])
    expect((await replay(short.bundle)).ok).toBe(true)
  })

  it('without a structured-source record it declines and the loop holds after round 1', async () => {
    const r = await runLoop(apTask, apStandIn(INVOICE, {}), { signingKey: privateKeyPem })
    expect(r.closed).toMatchObject({ outcome: 'HELD-FOR-HUMAN', rounds_used: 1 })
    expect(r.closed.reason).toMatch(/declined/)
  })

  it('recorded decision then stand-in: the per-round model field shows the agent changed', async () => {
    const docs = { invoice: INVOICE, purchase_order: rec(3).slice(0, rec(3).indexOf('GOODS')), goods_receipt: rec(3).slice(rec(3).indexOf('GOODS')) }
    const r = await runLoop(apTask, recordedThenStandIn(docs, 'approve', { model: 'published-config-x', note: 'a recorded decision, not attested' }), { signingKey: privateKeyPem })
    expect(r.closed).toMatchObject({ outcome: 'CONVERGED-FAIL', rounds_used: 2 })
    expect(r.bundle.rounds.map((x) => [x.agent.model, x.agent.evidence_tier])).toEqual([['published-config-x', 'T0'], [null, 'none']])
    expect((await replay(r.bundle)).ok).toBe(true)
    // a recorded hold the checker does not share (it approves): no remedy, never moved toward pay, held
    const full = { ...docs, goods_receipt: rec(4).slice(rec(4).indexOf('GOODS')) }
    const h = await runLoop(apTask, recordedThenStandIn(full, 'hold_price', { model: 'published-config-x', note: 'n' }), { signingKey: privateKeyPem })
    expect(h.closed).toMatchObject({ outcome: 'HELD-FOR-HUMAN', rounds_used: 1 })
  })
})

describe('the re-read stand-in through the loop (two readings must agree)', () => {
  const r1 = (): DeclarativeProposal => {
    const { tax_exclusive_amount: _x, ...rest } = BASE
    return { kind: 'declarative', decision: 'accept', extraction: rest, source: { text: TEXT, quotes: [] } }
  }
  it('both readings read the unreadable total the same: taken with its quote, PASS in round 2', async () => {
    const R2 = reading('R2', { ...flatBase, tax_exclusive_amount: 100 }, { tax_exclusive_amount: '100.00' }, 'Total without VAT EUR 100.00')
    const R3 = reading('R3', { ...flatBase, tax_exclusive_amount: 100 }, { tax_exclusive_amount: '100.00' }, 'Total without VAT EUR 1OO.00 100.00')
    const r = await runLoop(declTask, rereadStandIn(r1(), [R2, R3], RS), { signingKey: privateKeyPem })
    expect(r.closed).toMatchObject({ outcome: 'CONVERGED-PASS', rounds_used: 2 })
    const p2 = r.bundle.rounds[1]!.proposal as DeclarativeProposal
    expect(p2.extraction.tax_exclusive_amount).toBe(100)
    expect(p2.source!.text).toBe(`${TEXT}\f${R2.text}\f${R3.text}`)
    expect((await replay(r.bundle)).problems).toEqual([])
  })
  it('the readings disagree: nothing taken, the agent declines, the loop holds', async () => {
    const R2 = reading('R2', { ...flatBase, tax_exclusive_amount: 100 }, { tax_exclusive_amount: '100.00' }, 'Total without VAT EUR 100.00')
    const R3 = reading('R3', { ...flatBase, tax_exclusive_amount: 400 }, { tax_exclusive_amount: '400.00' }, 'Total without VAT EUR 400.00')
    const r = await runLoop(declTask, rereadStandIn(r1(), [R2, R3], RS), { signingKey: privateKeyPem })
    expect(r.closed).toMatchObject({ outcome: 'HELD-FOR-HUMAN', rounds_used: 1 })
  })
  it('a FAIL whose operands both readings confirm: the agent concedes, reject executes', async () => {
    const wrong: DeclarativeProposal = { kind: 'declarative', decision: 'accept', extraction: { ...BASE, payable_amount: 130 }, source: { text: TEXT, quotes: [] } }
    const vals = { ...flatBase, tax_exclusive_amount: 100, payable_amount: 130 }
    const r = await runLoop(declTask, rereadStandIn(wrong, [reading('R2', vals, {}, 'a'), reading('R3', vals, {}, 'b')], RS), { signingKey: privateKeyPem })
    expect(r.closed).toMatchObject({ outcome: 'CONVERGED-FAIL', rounds_used: 2 })
    // one reading missing an operand: no concession, held
    const { payable_amount: _p, ...partial } = vals
    const h = await runLoop(declTask, rereadStandIn(wrong, [reading('R2', vals, {}, 'a'), reading('R3', partial, {}, 'b')], RS), { signingKey: privateKeyPem })
    expect(h.closed.outcome).toBe('HELD-FOR-HUMAN')
  })
})

describe('the control: naive recompute', () => {
  const wrong: DeclarativeProposal = { kind: 'declarative', decision: 'accept', extraction: { ...BASE, payable_amount: 130 }, source: { text: 'Amount due for payment EUR 130.00', quotes: [{ id: 'payable_amount', quote: '130.00' }] } }
  it('is refused by the edit discipline; with the discipline off it converges to a PASS on the printed defect', async () => {
    const on = await runLoop(declTask, naiveRecompute(wrong), { signingKey: privateKeyPem })
    expect(on.closed.outcome).toBe('HELD-FOR-HUMAN')
    expect(on.closed.reason).toMatch(/payable_amount: its quote "130.00" does not read as 120/)
    const off = await runLoop(declTask, naiveRecompute(wrong), { signingKey: privateKeyPem, discipline: false })
    expect(off.closed).toMatchObject({ outcome: 'CONVERGED-PASS', rounds_used: 2 })
    expect((await replay(off.bundle)).ok).toBe(true) // the bundle is honest about it: discipline false is on its open row
    expect(off.bundle.discipline).toBe(false)
  })
})

describe('riposte-loop-run', () => {
  const memIo = () => {
    const files: Record<string, string> = {}
    return { files, io: { readFile: (p: string) => { if (!(p in files)) throw new Error(`ENOENT ${p}`); return files[p]! }, writeFile: (p: string, t: string) => { files[p] = t }, mkdir: () => {}, join: (...p: string[]) => p.join('/'), sha256: sha } }
  }
  it('ap mode writes a bundle per case and a summary', async () => {
    const { files, io } = memIo()
    files['c.jsonl'] = `${JSON.stringify({ id: 'EV-10001', invoice: INVOICE, history: [] })}\n` // engine 0.6.0: history known and empty
    files['erp.json'] = JSON.stringify({ 'EV-10001': rec(4) })
    files['k.pem'] = privateKeyPem
    const r = await loopRunCli(['ap', '--cases', 'c.jsonl', '--erp', 'erp.json', '--out', 'o', '--key', 'k.pem'], io)
    expect(r.code).toBe(0)
    expect(JSON.parse(r.out)).toEqual({ cases: 1, converged_pass: 1, converged_fail: 0, held: 0 })
    expect((await replay(JSON.parse(files['o/EV-10001.loop.json']!))).ok).toBe(true)
    expect(files['o/summary.jsonl']).toMatch(/"outcome":"CONVERGED-PASS"/)
  })
  it('reread mode, the control with the discipline off, and usage errors', async () => {
    const { files, io } = memIo()
    files['rs.json'] = JSON.stringify(RS)
    files['c.jsonl'] = `${JSON.stringify({ id: 'A-1', input_sha256: 'x', extraction: { ...BASE, payable_amount: 130 }, source: { text: 'Amount due for payment EUR 130.00', quotes: [{ id: 'payable_amount', quote: '130.00' }] }, readings: [{ name: 'R2', text: '', values: {}, quotes: {} }, { name: 'R3', text: '', values: {}, quotes: {} }] })}\n`
    expect(JSON.parse((await loopRunCli(['reread', '--cases', 'c.jsonl', '--ruleset', 'rs.json', '--out', 'o'], io)).out)).toMatchObject({ held: 1 })
    expect(JSON.parse((await loopRunCli(['reread', '--cases', 'c.jsonl', '--ruleset', 'rs.json', '--out', 'o', '--agent', 'naive', '--discipline', 'off'], io)).out)).toMatchObject({ converged_pass: 1 })
    expect((await loopRunCli([], io)).code).toBe(0)
    expect((await loopRunCli(['ap', '--cases', 'c.jsonl', '--out', 'o'], io)).code).toBe(3)
    expect((await loopRunCli(['zz'], io)).code).toBe(3)
    expect((await loopRunCli(['reread', '--cases', 'missing', '--ruleset', 'rs.json', '--out', 'o'], io)).code).toBe(3)
  })
  it('setPath creates what is missing', () => {
    const o: Record<string, unknown> = { lines: [{ id: '1' }] }
    setPath(o, 'lines[0].price_amount', 5)
    setPath(o, 'vat_breakdown[1].tax_amount', 2)
    expect(o).toEqual({ lines: [{ id: '1', price_amount: 5 }], vat_breakdown: [undefined, { tax_amount: 2 }] })
  })
})
