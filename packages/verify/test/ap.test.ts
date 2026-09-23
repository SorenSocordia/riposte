/**
 * AP three-way match pack (src/ap). The benchmark regression runs on Distil Labs' public, Apache-2.0 AP set
 * (data/real/D-ap-distil, attribution in data/real/NOTICE.md). The pack includes the two wording rules added in the
 * DISCLOSED run 2 (tuned on that set) — so the 100/100 here is a regression floor, not a generalization claim. The blind,
 * pre-registered result (82/100 decided, 0 wrong) is Result 1 of docs/BENCHMARK-AP.md.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyInvoiceMatch, splitApLayout, verifyReplay, generateSigningKeypair, signVerdict, verifyEnvelope, type ApDocuments } from '../src/index'

const NOW = () => new Date('2026-09-23T00:00:00Z')
const HERE = dirname(fileURLToPath(import.meta.url))

const po = (freight = 'not allowed'): string => `PURCHASE ORDER (ERP)
PO-48825 | Vendor: Northfield Material Handling | Freight: ${freight}
1. Extension cord 50 ft, 12 AWG | qty 5 | unit USD 47.30
2. Floor marking tape, yellow | qty 10 | unit USD 14.25
3. Wire shelving unit 48 in | qty 24 | unit USD 96.50
`
const gr = (r1 = 5, r2 = 10, r3 = 24): string => `GOODS RECEIPT (ERP) for PO-48825
1. Extension cord 50 ft, 12 AWG | received ${r1}
2. Floor marking tape, yellow | received ${r2}
3. Wire shelving unit 48 in | received ${r3}
`
const invoice = (o: { po?: string; tape?: string; total?: string; extra?: string } = {}): string => `INVOICE MESSAGE
INVOICE NM-84665   DATE 2026-09-28
CUST PO: ${o.po ?? 'PO-48825'}
1   CORD EXT 50FT 12AWG | 5 | 47.30 | 236.50
2   Floor marking tape, yellow | 10 | ${o.tape ?? '14.25 | 142.50'}
3   48 inch wire shelving unit | 24 | 96.50 | 2,316.00
${o.extra ?? ''}TOTAL DUE USD | ${o.total ?? '2,695.00'}
PREVIOUS BALANCE ON YOUR ACCOUNT: USD 1,290.00 (NOT PART OF THIS INVOICE).
`
const docs = (o: Parameters<typeof invoice>[0] = {}, freight?: string, receipt?: [number, number, number]): ApDocuments =>
  ({ invoice: invoice(o), purchase_order: po(freight), goods_receipt: receipt ? gr(...receipt) : gr() })

describe('AP three-way match — policy decisions', () => {
  it('approves a clean invoice (abbreviated names, stray previous balance ignored)', () => {
    const r = verifyInvoiceMatch(docs(), { now: NOW })
    expect(r.decision).toBe('approve')
    expect(r.payable).toBe(true)
    expect(r.verdict.outcome).toBe('PASS')
  })
  it('README example: tape 2.5% over PO price -> hold_price with the exact item and values', () => {
    const r = verifyInvoiceMatch(docs({ tape: '14.61 | 146.10', total: '2,698.60' }), { now: NOW })
    expect(r.decision).toBe('hold_price')
    expect(r.grounding).toEqual({ invoice_number: 'NM-84665', po_number: 'PO-48825', item: 'Floor marking tape, yellow', invoiced: 14.61, expected: 14.25 })
    expect(r.payable).toBe(false)
  })
  it('a price 1.8% over (inside tolerance) approves — the near-miss LLMs falsely hold', () => {
    const r = verifyInvoiceMatch(docs({ tape: '14.50 | 145.00', total: '2,697.50' }), { now: NOW })
    expect(r.decision).toBe('approve')
  })
  it('transposed PO number -> hold_no_po, stops there', () => {
    const r = verifyInvoiceMatch(docs({ po: 'PO-48852' }), { now: NOW })
    expect(r.decision).toBe('hold_no_po')
    expect(r.grounding.invoiced).toBe('PO-48852')
    expect(r.grounding.expected).toBe('PO-48825')
  })
  it('billed more than received -> hold_quantity naming the PO line', () => {
    const r = verifyInvoiceMatch(docs({}, undefined, [3, 10, 24]), { now: NOW })
    expect(r.decision).toBe('hold_quantity')
    expect(r.grounding).toMatchObject({ item: 'Extension cord 50 ft, 12 AWG', invoiced: 5, expected: 3 })
  })
  it('total does not add up -> hold_total with stated vs computed', () => {
    const r = verifyInvoiceMatch(docs({ total: '2,705.00' }), { now: NOW })
    expect(r.decision).toBe('hold_total')
    expect(r.grounding).toMatchObject({ invoiced: 2705, expected: 2695 })
  })
  it('freight counts only when the PO allows it', () => {
    const withFreight = { extra: 'Freight: USD 35.00\n', total: '2,730.00' }
    expect(verifyInvoiceMatch(docs(withFreight, 'may be added by the vendor'), { now: NOW }).decision).toBe('approve')
    expect(verifyInvoiceMatch(docs(withFreight, 'not allowed'), { now: NOW }).decision).toBe('hold_total')
  })
})

describe('AP three-way match — abstains instead of guessing', () => {
  it('no readable total -> abstain (payable null), with the reason', () => {
    const r = verifyInvoiceMatch({ ...docs(), invoice: invoice().replace(/TOTAL DUE USD \| 2,695.00\n/, '') }, { now: NOW })
    expect(r.decision).toBe('abstain')
    expect(r.payable).toBeNull()
    expect(r.reasons[0]).toMatch(/no stated total/)
  })
  it('freight billed but the PO is silent on freight -> abstain', () => {
    const r = verifyInvoiceMatch({ ...docs({ extra: 'Freight: USD 35.00\n', total: '2,730.00' }), purchase_order: po().replace(/ \| Freight: not allowed/, '') }, { now: NOW })
    expect(r.decision).toBe('abstain')
  })
  it('a missing invoice line -> abstain on the line checks (never a guessed match)', () => {
    const r = verifyInvoiceMatch({ ...docs(), invoice: invoice().replace(/^2 {3}Floor.*\n/m, '') }, { now: NOW })
    expect(r.decision).toBe('abstain')
    expect(r.verdict.claims.find((c) => c.claim_id === 'ap.line[2].quantity')!.insufficiency!.reason).toBe('AMBIGUOUS_REFERENCE')
  })
  it('a later check FAILs while an earlier one is undecided -> abstain but payable=false', () => {
    const r = verifyInvoiceMatch({ ...docs({ total: '9,999.00' }), invoice: invoice({ total: '9,999.00' }).replace(/^2 {3}Floor.*\n/m, '') }, { now: NOW })
    expect(r.decision).toBe('abstain')
    expect(r.payable).toBe(false)
  })
})

describe('AP three-way match — proof object contract', () => {
  it('every PASS/FAIL carries span evidence; every INSUFFICIENT carries an explained reason', () => {
    for (const d of [docs(), docs({ tape: '14.61 | 146.10', total: '2,698.60' }), { ...docs(), invoice: invoice().replace(/TOTAL DUE.*\n/, '') }]) {
      const v = verifyInvoiceMatch(d, { now: NOW }).verdict
      for (const c of v.claims) {
        if (c.outcome === 'INSUFFICIENT_DATA') expect(c.insufficiency?.detail.length).toBeGreaterThan(0)
        else expect(c.evidence.length).toBeGreaterThan(0)
      }
      expect(v.coverage.claims_total).toBe(v.claims.length)
    }
  })
  it('deterministic: same input -> byte-identical verdict (except issued_at); replays without the engine', () => {
    const d = docs({ tape: '14.61 | 146.10', total: '2,698.60' })
    const a = verifyInvoiceMatch(d, { now: NOW }).verdict
    const b = verifyInvoiceMatch(d, { now: () => new Date('2030-01-01T00:00:00Z') }).verdict
    expect({ ...a, issued_at: '' }).toEqual({ ...b, issued_at: '' })
    expect(verifyReplay(a, { ap: d, policy: { price_tolerance: 0.02, total_tolerance: 0.005 } }).ok).toBe(true)
    expect(verifyReplay(a, { ap: { ...d, invoice: d.invoice + ' ' }, policy: { price_tolerance: 0.02, total_tolerance: 0.005 } }).ok).toBe(false)
  })
  it('signs as a Verifiable Verdict; flipping the outcome breaks the signature', () => {
    const { privateKeyPem } = generateSigningKeypair()
    const env = signVerdict(verifyInvoiceMatch(docs({ total: '2,705.00' }), { now: NOW }).verdict, privateKeyPem)
    expect(verifyEnvelope(env).ok).toBe(true)
    const forged = structuredClone(env)
    forged.verdict.outcome = 'PASS'
    expect(verifyEnvelope(forged).ok).toBe(false)
  })
})

describe('AP benchmark regression — Distil Labs public set (Apache-2.0; includes the disclosed run-2 wording rules)', () => {
  const cases = readFileSync(join(HERE, '..', 'data', 'real', 'D-ap-distil', 'invoice_cases.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  const numEq = (a: unknown, b: unknown): boolean => (a == null || b == null) ? a == null && b == null
    : typeof b === 'number' ? Math.abs(Number(a) - b) <= 0.005 : String(a) === String(b)
  it('100/100 decisions and six-field answers, 0 wrong decisions', () => {
    let decided = 0, right = 0, six = 0, wrong = 0
    for (const c of cases) {
      const d = splitApLayout(c.input)!
      const r = verifyInvoiceMatch(d, { now: NOW })
      if (r.decision !== 'abstain') decided++
      if (r.decision === c.decision) right++
      else if (r.decision !== 'abstain') wrong++
      const g = r.grounding
      if (r.decision === c.decision && g.invoice_number === c.invoice.invoice_number && g.po_number === c.invoice.po_number &&
        (g.item ?? null) === (c.grounding?.item ?? null) && numEq(g.invoiced, c.grounding?.invoice_value ?? null) && numEq(g.expected, c.grounding?.reference_value ?? null)) six++
    }
    expect(wrong).toBe(0)
    expect(decided).toBe(100)
    expect(right).toBe(100)
    expect(six).toBe(100)
  })
})

describe('AP surfaces — CLI `verify ap` and MCP `verify_invoice_match`', () => {
  it('CLI: layout file -> JSON result, exit 1 on a hold, 0 on approve', async () => {
    const { run } = await import('../src/cli')
    const { writeFileSync, mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const dir = mkdtempSync(join(tmpdir(), 'ap-'))
    const d = docs({ total: '2,705.00' })
    const f = join(dir, 'layout.txt')
    writeFileSync(f, `${d.invoice}\n${d.purchase_order}\n${d.goods_receipt}`)
    let out = ''
    const io = { out: (s: string) => { out += s }, err: () => {} }
    expect(run(['ap', f], io)).toBe(1)
    expect(JSON.parse(out).decision).toBe('hold_total')
    const g = join(dir, 'ok.txt')
    const ok = docs()
    writeFileSync(g, `${ok.invoice}\n${ok.purchase_order}\n${ok.goods_receipt}`)
    out = ''
    expect(run(['ap', g], io)).toBe(0)
  })
  it('MCP: tool is listed and callable with the three documents', async () => {
    const { handleRequest } = await import('../src/mcp/server')
    const list = handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) as { result: { tools: { name: string }[] } }
    expect(list.result.tools.map((t) => t.name)).toContain('verify_invoice_match')
    const d = docs({ tape: '14.61 | 146.10', total: '2,698.60' })
    const call = handleRequest({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'verify_invoice_match', arguments: { invoice: d.invoice, purchase_order: d.purchase_order, goods_receipt: d.goods_receipt } } }) as { result: { structuredContent: { decision: string } } }
    expect(call.result.structuredContent.decision).toBe('hold_price')
  })
})

describe('AP duplicate check (payment history)', () => {
  const booked = (o: Partial<{ invoice_number: string; po_number: string; total: number; vendor: string; paid_on: string }> = {}) =>
    ({ invoice_number: 'NM-11111', po_number: 'PO-48825', total: 100, vendor: 'Northfield Material Handling', paid_on: '2026-09-01', ...o })
  it('without history: runs the four checks and SAYS the duplicate check did not run', () => {
    const r = verifyInvoiceMatch(docs(), { now: NOW })
    expect(r.decision).toBe('approve')
    expect(r.not_checked.join(' ')).toMatch(/duplicate check: no payment history/)
  })
  it('exact repeat of a booked invoice -> hold_duplicate, before any other check', () => {
    const r = verifyInvoiceMatch({ ...docs({ total: '2,705.00' }), history: [booked({ invoice_number: 'NM-84665' })] }, { now: NOW })
    expect(r.decision).toBe('hold_duplicate')
    expect(r.payable).toBe(false)
    expect(r.grounding).toMatchObject({ invoiced: 'NM-84665', expected: 'NM-84665' })
    expect(r.reasons[0]).toMatch(/already in the books \(paid 2026-09-01\)/)
  })
  it('same number from a DIFFERENT vendor is not a duplicate', () => {
    const r = verifyInvoiceMatch({ ...docs(), history: [booked({ invoice_number: 'NM-84665', vendor: 'Some Other Co' })] }, { now: NOW })
    expect(r.decision).toBe('approve')
  })
  it('same vendor + PO + total under a new number -> abstain for a person (possible resubmission)', () => {
    const r = verifyInvoiceMatch({ ...docs(), history: [booked({ invoice_number: 'NM-99999', total: 2695 })] }, { now: NOW })
    expect(r.decision).toBe('abstain')
    expect(r.reasons[0]).toMatch(/possible resubmission/)
  })
  it('clean history -> the duplicate claim PASSes and the decision stands', () => {
    const r = verifyInvoiceMatch({ ...docs(), history: [booked()] }, { now: NOW })
    expect(r.decision).toBe('approve')
    expect(r.verdict.claims.find((c) => c.claim_id === 'ap.duplicate')!.outcome).toBe('PASS')
    expect(r.not_checked).toEqual([])
  })
})
