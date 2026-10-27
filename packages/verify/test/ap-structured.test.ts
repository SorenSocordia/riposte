/**
 * 2026-10-03: structured AP input — ruleset ap-structured@0.1.0 (src/ap/structured.ts).
 *
 *   1. validation: good inputs pass; bad ones fail with typed, field-named errors; the published JSON Schema
 *      (docs/ap-input.schema.json) agrees with the validator on shape (a small draft 2020-12 evaluator below), and the
 *      validator alone catches what a schema cannot (unique ids, references, currencies)
 *   2. path parity: every Distil case the text path reads cleanly, converted from the text parser's OWN reading into
 *      structured input, gets the same decision, grounding, claims and remedies (a determinism check, not accuracy)
 *   3. a planted-mismatch matrix: each rule × PASS / FAIL / ABSTAIN, and its remedies
 *   4. a bill line with no PO line abstains with a missing-operand remedy naming the field
 *   5. every evidence pointer resolves into the input; the proof replays; the CLI takes --input
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import {
  verifyInvoiceMatch, splitApLayout, verifyBillMatch, validateApInput, apInputDocuments, resolvePointer, verifyReplay, hashOf,
  ApInputInvalid, AP_INPUT_SCHEMA, structuredFromText, AP_STRUCTURED_RULESET, type ApStructuredInput, type ApResult, type ApDocuments, type PriorInvoice,
} from '../src/index'
import { parseInvoice } from '../src/ap/parse'
import { apLineMathProblem } from '../src/ap/line-math'
import { replayReading } from '../src/protocol/replay-case'
import { canonicalize } from '../src/verdict/canonical'

const NOW = () => new Date('2026-10-03T00:00:00Z')
const HERE = dirname(fileURLToPath(import.meta.url))
const clone = <T>(x: T): T => structuredClone(x)

// ── a clean bill: the same facts as test/ap.test.ts's text fixture ─────────────────────────────────────────────────────
const base = (): ApStructuredInput => ({
  schema: 'riposte.ap-input/0.1.0',
  bill: {
    invoice_number: 'NM-84665', vendor: { name: 'Northfield Material Handling' }, purchase_order_number: 'PO-48825', currency: 'USD',
    amount: 2695, issued_at: '2026-09-28',
    line_items: [
      { purchase_order_line_item_id: 'pol-1', description: 'CORD EXT 50FT 12AWG', quantity: 5, unit_price: 47.3, amount: 236.5 },
      { purchase_order_line_item_id: 'pol-2', description: 'TAPE FLOOR YEL', quantity: 10, unit_price: 14.25, amount: 142.5 },
      { purchase_order_line_item_id: 'pol-3', description: 'SHELF WIRE 48IN', quantity: 24, unit_price: 96.5, amount: 2316 },
    ],
  },
  purchase_order: {
    id: 'po-1', purchase_order_number: 'PO-48825', vendor: { name: 'Northfield Material Handling' }, currency: 'USD', freight_allowed: false,
    line_items: [
      { id: 'pol-1', description: 'Extension cord 50 ft, 12 AWG', quantity: 5, unit_price: 47.3 },
      { id: 'pol-2', description: 'Floor marking tape, yellow', quantity: 10, unit_price: 14.25 },
      { id: 'pol-3', description: 'Wire shelving unit 48 in', quantity: 24, unit_price: 96.5 },
    ],
  },
  item_receipts: [{ id: 'ir-1', purchase_order_id: 'po-1', line_items: [
    { purchase_order_line_item_id: 'pol-1', quantity: 5 }, { purchase_order_line_item_id: 'pol-2', quantity: 10 }, { purchase_order_line_item_id: 'pol-3', quantity: 24 },
  ] }],
})
const run = (x: unknown): ApResult => verifyBillMatch(x, { now: NOW })
const claim = (r: ApResult, id: string) => r.verdict.claims.find((c) => c.claim_id === id)

// ── a small draft 2020-12 evaluator: the keywords the published schema uses, nothing more ───────────────────────────────
type S = Record<string, any>
function schemaValid(s: S, x: unknown, root: S = s): boolean {
  if (s.$ref) return schemaValid(root.$defs[(s.$ref as string).replace('#/$defs/', '')], x, root)
  if (s.anyOf && !(s.anyOf as S[]).some((t) => schemaValid(t, x, root))) return false
  if (s.oneOf && (s.oneOf as S[]).filter((t) => schemaValid(t, x, root)).length !== 1) return false
  if ('const' in s && x !== s.const) return false
  if (s.enum && !(s.enum as unknown[]).includes(x)) return false
  if (s.type) {
    const types: string[] = Array.isArray(s.type) ? s.type : [s.type]
    const is = (t: string): boolean => t === 'null' ? x === null : t === 'integer' ? Number.isInteger(x) : t === 'number' ? typeof x === 'number'
      : t === 'array' ? Array.isArray(x) : t === 'object' ? typeof x === 'object' && x !== null && !Array.isArray(x) : typeof x === t
    if (!types.some(is)) return false
  }
  if (typeof x === 'string') {
    if (s.minLength !== undefined && x.length < s.minLength) return false
    if (s.maxLength !== undefined && x.length > s.maxLength) return false
    if (s.pattern && !new RegExp(s.pattern, 'u').test(x)) return false
  }
  if (typeof x === 'number') {
    if (s.minimum !== undefined && x < s.minimum) return false
    if (s.maximum !== undefined && x > s.maximum) return false
  }
  if (Array.isArray(x)) {
    if (s.minItems !== undefined && x.length < s.minItems) return false
    if (s.maxItems !== undefined && x.length > s.maxItems) return false
    if (s.items && !x.every((v) => schemaValid(s.items, v, root))) return false
  }
  if (typeof x === 'object' && x !== null && !Array.isArray(x)) {
    const o = x as Record<string, unknown>
    if (s.required && !(s.required as string[]).every((k) => k in o)) return false
    for (const [k, v] of Object.entries(o)) {
      if (s.properties?.[k]) { if (!schemaValid(s.properties[k], v, root)) return false }
      else if (s.additionalProperties === false) return false
    }
  }
  return true
}
const schema = AP_INPUT_SCHEMA as unknown as S

describe('validation: typed errors that name the field', () => {
  const good: [string, (x: ApStructuredInput) => unknown][] = [
    ['the base bill', (x) => x],
    ['decimal strings', (x) => { x.bill.amount = '2695.00'; x.bill.line_items[0]!.unit_price = '47.30'; x.bill.line_items[0]!.quantity = '5'; return x }],
    ["Ramp's CurrencyAmount (minor units)", (x) => { x.bill.amount = { amount: 269500, currency_code: 'USD', minor_unit_conversion_rate: 100 }; x.purchase_order.line_items[0]!.unit_price = { amount: 4730, currency_code: 'USD' }; return x }],
    ['nullable fields null', (x) => { x.bill.freight = null; x.bill.tax = null; x.purchase_order.freight_allowed = null; x.payment_history = null; x.decision = null; x.bill.line_items[0]!.sku = null; return x }],
    ['payment history and a decision', (x) => { x.payment_history = [{ invoice_number: 'NM-1', amount: '10.00', paid_at: '2026-09-01' }]; x.decision = { action: 'hold', reason: 'hold_price', confidence: 0.91, rationale: 'tape over PO', model: 'some-model' }; return x }],
    ['no item receipts at all', (x) => { x.item_receipts = []; return x }],
  ]
  for (const [name, f] of good) {
    it(`accepts: ${name} (validator and JSON Schema agree)`, () => {
      const x = f(base())
      expect(validateApInput(x)).toMatchObject({ ok: true })
      expect(schemaValid(schema, x)).toBe(true)
    })
  }

  const bad: [string, (x: any) => unknown, string, string][] = [
    ['not an object', () => [1, 2], 'ap_input.not_object', ''],
    ['the wrong schema version', (x) => { x.schema = 'riposte.ap-input/9'; return x }, 'ap_input.schema_version', '/schema'],
    ['no bill', (x) => { delete x.bill; return x }, 'ap_input.missing_field', '/bill'],
    ['a misspelt field', (x) => { x.bill.line_items[1].quantiy = 3; return x }, 'ap_input.unknown_field', '/bill/line_items/1/quantiy'],
    ['a money value with a comma', (x) => { x.bill.amount = '2,695.00'; return x }, 'ap_input.invalid_money', '/bill/amount'],
    ['a negative unit price', (x) => { x.bill.line_items[2].unit_price = -1; return x }, 'ap_input.out_of_range', '/bill/line_items/2/unit_price'],
    ['a negative quantity', (x) => { x.item_receipts[0].line_items[0].quantity = -5; return x }, 'ap_input.invalid_quantity', '/item_receipts/0/line_items/0/quantity'],
    ['fractional minor units', (x) => { x.bill.amount = { amount: 12.5, currency_code: 'USD' }; return x }, 'ap_input.invalid_money', '/bill/amount/amount'],
    ['a lower-case currency', (x) => { x.bill.currency = 'usd'; return x }, 'ap_input.invalid_enum', '/bill/currency'],
    ['an empty invoice number', (x) => { x.bill.invoice_number = '  '; return x }, 'ap_input.missing_field', '/bill/invoice_number'],
    ['an overlong PO line id', (x) => { x.purchase_order.line_items[0].id = 'x'.repeat(257); return x }, 'ap_input.too_long', '/purchase_order/line_items/0/id'],
    ['a decision of "approve"', (x) => { x.decision = { action: 'approve' }; return x }, 'ap_input.invalid_enum', '/decision/action'],
    ['confidence above 1', (x) => { x.decision = { action: 'pay', confidence: 1.5 }; return x }, 'ap_input.out_of_range', '/decision/confidence'],
    ['no bill lines', (x) => { x.bill.line_items = []; return x }, 'ap_input.missing_field', '/bill/line_items'],
    ['1,001 bill lines (the cap)', (x) => { x.bill.line_items = Array.from({ length: 1001 }, () => ({ amount: 1 })); return x }, 'ap_input.too_many', '/bill/line_items'],
    ['10,001 payment-history rows (the cap)', (x) => { x.payment_history = Array.from({ length: 10_001 }, (_, i) => ({ invoice_number: `I-${i}` })); return x }, 'ap_input.too_many', '/payment_history'],
  ]
  for (const [name, f, code, field] of bad) {
    it(`refuses: ${name} → ${code} at "${field}" (the JSON Schema refuses it too)`, () => {
      const x = f(base())
      const r = validateApInput(x)
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.errors).toContainEqual(expect.objectContaining({ code, field }))
      for (const e of r.errors) expect(e.message.length).toBeGreaterThan(5)
      expect(schemaValid(schema, x)).toBe(false)
      expect(() => run(x)).toThrow(ApInputInvalid)
    })
  }

  const semantic: [string, (x: any) => unknown, string, string][] = [
    ['two PO lines with one id', (x) => { x.purchase_order.line_items[1].id = 'pol-1'; x.bill.line_items[1].purchase_order_line_item_id = 'pol-1'; x.item_receipts[0].line_items[1].purchase_order_line_item_id = 'pol-1'; return x }, 'ap_input.duplicate_id', '/purchase_order/line_items/1/id'],
    ['a receipt line naming no PO line', (x) => { x.item_receipts[0].line_items[2].purchase_order_line_item_id = 'pol-9'; return x }, 'ap_input.reference_unknown', '/item_receipts/0/line_items/2/purchase_order_line_item_id'],
    ['a receipt for another PO', (x) => { x.item_receipts[0].purchase_order_id = 'po-2'; return x }, 'ap_input.reference_unknown', '/item_receipts/0/purchase_order_id'],
    ['two currencies on one bill', (x) => { x.bill.line_items[0].amount = { amount: 23650, currency_code: 'EUR' }; return x }, 'ap_input.currency_conflict', '/bill/line_items/0/amount/currency_code'],
    ['minor units with no currency anywhere', (x) => { delete x.bill.currency; x.bill.amount = { amount: 269500 }; return x }, 'ap_input.currency_missing', '/bill/amount'],
    ['"pay" with a hold reason', (x) => { x.decision = { action: 'pay', reason: 'hold_price' }; return x }, 'ap_input.conflict', '/decision/reason'],
  ]
  for (const [name, f, code, field] of semantic) {
    it(`refuses what a schema cannot see: ${name} → ${code}`, () => {
      const x = f(base())
      expect(schemaValid(schema, x)).toBe(true) // the shape is fine
      const r = validateApInput(x)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.errors).toContainEqual(expect.objectContaining({ code, field }))
    })
  }

  it('the schema drives its own negatives: every required field removed, and an unknown field added, at every object', () => {
    const objects: [string, (x: any) => any, S][] = [
      ['', (x) => x, schema],
      ['/bill', (x) => x.bill, schema.$defs.bill], ['/bill/vendor', (x) => x.bill.vendor, schema.$defs.vendor],
      ['/bill/line_items/0', (x) => x.bill.line_items[0], schema.$defs.bill_line],
      ['/purchase_order', (x) => x.purchase_order, schema.$defs.purchase_order], ['/purchase_order/line_items/0', (x) => x.purchase_order.line_items[0], schema.$defs.po_line],
      ['/item_receipts/0', (x) => x.item_receipts[0], schema.$defs.item_receipt], ['/item_receipts/0/line_items/0', (x) => x.item_receipts[0].line_items[0], schema.$defs.receipt_line],
    ]
    let n = 0
    for (const [ptr, get, s] of objects) {
      for (const k of (s.required ?? []) as string[]) {
        const x = base() as any
        delete get(x)[k]
        const r = validateApInput(x)
        expect(r.ok, `${ptr}/${k}`).toBe(false)
        if (!r.ok) expect(r.errors).toContainEqual(expect.objectContaining({ code: 'ap_input.missing_field', field: `${ptr}/${k}` }))
        expect(schemaValid(schema, x)).toBe(false)
        n++
      }
      const x = base() as any
      get(x).zz_unknown = 1
      const r = validateApInput(x)
      if (!r.ok) expect(r.errors).toContainEqual(expect.objectContaining({ code: 'ap_input.unknown_field', field: `${ptr}/zz_unknown` }))
      expect(r.ok).toBe(false)
      expect(schemaValid(schema, x)).toBe(false)
      n++
    }
    expect(n).toBeGreaterThanOrEqual(20)
  })

  it('docs/ap-input.schema.json is the schema the code carries, byte for byte as JSON', () => {
    const file = JSON.parse(readFileSync(join(HERE, '..', 'docs', 'ap-input.schema.json'), 'utf8'))
    expect(file).toEqual(JSON.parse(JSON.stringify(AP_INPUT_SCHEMA)))
  })
})

// ── path parity: the text parser's own reading, as structured input ──────────────────────────────────────────────────────
/** The library's conversion (src/ap/from-text.ts): the input, or why the text reading has none. */
const textToStructured = (d: ApDocuments): ApStructuredInput | string => { const r = structuredFromText(d); return r.ok ? r.input : r.reason }

/**
 * Everything both paths must agree on: decision, grounding, each claim's rule/outcome/reason/values, coverage, remedies.
 * 2026-10-05: the vendor check (ap.vendor) reads the vendor two ways by design. Structured input compares two
 * fields (bill.vendor, purchase_order.vendor); the text path reads whether the invoice names the PO's vendor (by name or by a
 * sender's address built from it). Its rule, kind, field, outcome and reason must agree; its asserted, result and operands
 * (what each path read) are left out of the comparison.
 */
const projection = (r: ApResult) => ({
  decision: r.decision, payable: r.payable, grounding: r.grounding, outcome: r.verdict.outcome, coverage: r.verdict.coverage,
  claims: [...r.verdict.claims].sort((a, b) => a.claim_id.localeCompare(b.claim_id)).map((c) => ({
    id: c.claim_id, rule: c.rule_id, kind: c.kind, outcome: c.outcome, field: c.field, reason: c.insufficiency?.reason ?? null,
    ...(c.claim_id === 'ap.vendor' ? {} : { asserted: c.asserted, result: c.computation?.result ?? null, operands: c.computation?.operands ?? null }), variance: c.variance ?? null,
  })),
  remedies: (r.verdict.remedies ?? []).map((m) => ({ kind: m.kind, authority: m.authority ?? null, transform: m.transform ?? null, clears: m.clears, claims: m.claims, source: m.operand?.source ?? null })),
})

describe('path parity: text and structured give the same verdict on the same facts', () => {
  const cases = readFileSync(join(HERE, '..', 'data', 'real', 'D-ap-distil', 'invoice_cases.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { id: string; input: string })

  it('the Distil cases, converted from the text parser\'s own reading: every one compared agrees (at least 20)', () => {
    let compared = 0
    const skipped: string[] = []
    const decisions = new Map<string, number>()
    for (const c of cases) {
      const d = splitApLayout(c.input)!
      const x = textToStructured(d)
      if (typeof x === 'string') { skipped.push(`${c.id}: ${x}`); continue }
      const t = verifyInvoiceMatch(d, { now: NOW })
      const s = run(x)
      expect(projection(s), c.id).toEqual(projection(t))
      expect(s.verdict.ruleset).toEqual(AP_STRUCTURED_RULESET)
      decisions.set(s.decision, (decisions.get(s.decision) ?? 0) + 1)
      compared++
    }
    expect(compared).toBeGreaterThanOrEqual(20)
    // the record of what was compared (printed by the run)
    console.log(`[text and structured parity] compared ${compared} of ${cases.length}; skipped ${skipped.length}${skipped.length ? `: ${skipped.join('; ')}` : ''}; decisions ${JSON.stringify(Object.fromEntries([...decisions].sort()))}`)
  })

  it('with payment history on 20 cases (clean, an exact repeat, a resubmission under a new number): still the same verdicts', () => {
    let compared = 0
    for (const c of cases.slice(0, 40)) {
      const d0 = splitApLayout(c.input)!
      const inv = parseInvoice(d0.invoice)
      const total = inv.totals[0]?.value
      const poNo = inv.poNumbers[0]?.value
      const vendor = d0.purchase_order.match(/Vendor:\s*([^|\n]+)/)?.[1]?.trim()
      if (!inv.invoiceNumber || total === undefined || !poNo || !vendor) continue
      const variants: PriorInvoice[][] = [
        [{ invoice_number: 'ZZ-0001', vendor, po_number: 'PO-1', total: 1, paid_on: '2026-01-01' }],
        [{ invoice_number: inv.invoiceNumber.value, vendor, po_number: poNo, total, paid_on: '2026-09-01' }],
        [{ invoice_number: `${inv.invoiceNumber.value}-B`, vendor, po_number: poNo, total, paid_on: '2026-09-01' }],
      ]
      let ok = true
      for (const history of variants) {
        const d = { ...d0, history }
        const x = textToStructured(d)
        if (typeof x === 'string') { ok = false; break }
        expect(projection(run(x)), `${c.id} ${history[0]!.invoice_number}`).toEqual(projection(verifyInvoiceMatch(d, { now: NOW })))
      }
      if (ok) compared++
      if (compared === 20) break
    }
    expect(compared).toBe(20)
  })
})

// ── the planted-mismatch matrix ───────────────────────────────────────────────────────────────────────────────────────────
describe('planted mismatches: each rule × PASS / FAIL / ABSTAIN, with its remedies', () => {
  // engine 0.6.0: a bill is approved only against a known book, so each planted bill states an empty payment
  // history unless its row plants one; the no-history decision is tested in test/ap-near-match.test.ts
  const plant = (f: (x: ApStructuredInput) => void): ApResult => { const x = base(); x.payment_history = []; f(x); return run(x) }
  const rows: [string, (x: ApStructuredInput) => void, string, string, string, string?][] = [
    // [name, plant, claim, outcome, decision, insufficiency reason]
    ['clean', () => {}, 'ap.total', 'PASS', 'approve'],
    ['PO: the bill cites another PO', (x) => { x.bill.purchase_order_number = 'PO-48826' }, 'ap.po_number', 'FAIL', 'hold_no_po'],
    ['PO: the bill cites none', (x) => { delete x.bill.purchase_order_number }, 'ap.po_number', 'FAIL', 'hold_no_po'],
    ['quantity: billed 24, received 20', (x) => { x.item_receipts[0]!.line_items[2]!.quantity = 20 }, 'ap.line[3].quantity', 'FAIL', 'hold_quantity'],
    ['quantity: two receipts sum to what was billed', (x) => { x.item_receipts[0]!.line_items[2]!.quantity = 20; x.item_receipts.push({ line_items: [{ purchase_order_line_item_id: 'pol-3', quantity: 4 }] }) }, 'ap.line[3].quantity', 'PASS', 'approve'],
    ['quantity: nothing received on the line', (x) => { x.item_receipts[0]!.line_items.splice(2, 1) }, 'ap.line[3].quantity', 'INSUFFICIENT_DATA', 'abstain', 'REFERENCE_NOT_PROVIDED'],
    ['quantity: the bill line states none', (x) => { delete x.bill.line_items[1]!.quantity }, 'ap.line[2].quantity', 'INSUFFICIENT_DATA', 'abstain', 'FIELD_MISSING'],
    ['price: exactly 2% over', (x) => { x.bill.line_items[1]!.unit_price = 14.535; x.bill.line_items[1]!.amount = 145.35; x.bill.amount = 2697.85 }, 'ap.line[2].price', 'PASS', 'approve'],
    ['price: 2.5% over', (x) => { x.bill.line_items[1]!.unit_price = 14.61; x.bill.line_items[1]!.amount = 146.1; x.bill.amount = 2698.6 }, 'ap.line[2].price', 'FAIL', 'hold_price'],
    ['price: bill in EUR, PO in USD', (x) => { x.bill.currency = 'EUR' }, 'ap.line[1].price', 'INSUFFICIENT_DATA', 'abstain', 'AMBIGUOUS_UNIT'],
    ['price: the bill line states no unit price', (x) => { delete x.bill.line_items[0]!.unit_price }, 'ap.line[1].price', 'INSUFFICIENT_DATA', 'abstain', 'FIELD_MISSING'],
    ['line math: 10 × 14.25 stated as 152.50 (total adds up)', (x) => { x.bill.line_items[1]!.amount = 152.5; x.bill.amount = 2705 }, 'ap.line[2].amount', 'FAIL', 'hold_line_math'],
    ['line math: one minor unit of rounding', (x) => { x.bill.line_items[1]!.unit_price = 14.254; x.bill.line_items[1]!.amount = 142.54; x.bill.amount = 2695.04 }, 'ap.line[2].amount', 'PASS', 'approve'],
    ['line math: off, but the line carries a discount', (x) => { x.bill.line_items[1]!.amount = 128.25; x.bill.line_items[1]!.discount_amount = 14.25; x.bill.amount = 2680.75 }, 'ap.line[2].amount', 'INSUFFICIENT_DATA', 'abstain', 'AMBIGUOUS_FIELD'],
    ['total: does not add up', (x) => { x.bill.amount = 2705 }, 'ap.total', 'FAIL', 'hold_total'],
    ['total: freight the PO allows', (x) => { x.bill.freight = 40; x.bill.amount = 2735; x.purchase_order.freight_allowed = true }, 'ap.total', 'PASS', 'approve'],
    ['total: freight the PO does not allow', (x) => { x.bill.freight = 40; x.bill.amount = 2735 }, 'ap.total', 'FAIL', 'hold_total'],
    ['total: freight and the PO is silent', (x) => { x.bill.freight = 40; x.bill.amount = 2735; delete x.purchase_order.freight_allowed }, 'ap.total', 'INSUFFICIENT_DATA', 'abstain', 'AMBIGUOUS_UNIT'],
    // 2026-10-05: tax billed is checked against the PO's stated tax terms (src/ap/tax.ts); a PO silent on tax
    // sends taxed bills to a person, so the "summed" row states the PO's rate (8% of 2,695.00 is 215.60)
    ['total: tax is summed', (x) => { x.bill.tax = 215.6; x.bill.amount = 2910.6; x.purchase_order.tax_rate = 0.08 }, 'ap.total', 'PASS', 'approve'],
    ['tax: at the PO\'s stated rate', (x) => { x.bill.tax = 215.6; x.bill.amount = 2910.6; x.purchase_order.tax_rate = 0.08 }, 'ap.tax', 'PASS', 'approve'],
    ['tax: billed, the PO silent on tax', (x) => { x.bill.tax = 215.6; x.bill.amount = 2910.6 }, 'ap.tax', 'INSUFFICIENT_DATA', 'abstain', 'FIELD_MISSING'],
    ['tax: billed, the PO states a rate of 0', (x) => { x.bill.tax = 215.6; x.bill.amount = 2910.6; x.purchase_order.tax_rate = 0 }, 'ap.tax', 'FAIL', 'hold_total'],
    ['tax: over the PO\'s rate beyond the tolerance', (x) => { x.bill.tax = 269.5; x.bill.amount = 2964.5; x.purchase_order.tax_rate = 0.08 }, 'ap.tax', 'INSUFFICIENT_DATA', 'abstain', 'AMBIGUOUS_REFERENCE'],
    ['tax: none billed (0)', (x) => { x.bill.tax = 0 }, 'ap.tax', 'PASS', 'approve'],
    // 2026-10-05: the bill's vendor against the PO's (src/ap/vendor.ts)
    ['vendor: the same name', () => {}, 'ap.vendor', 'PASS', 'approve'],
    ['vendor: a name variant (", Inc.")', (x) => { x.bill.vendor = { name: 'Northfield Material Handling, Inc.' } }, 'ap.vendor', 'PASS', 'approve'],
    ['vendor: another vendor', (x) => { x.bill.vendor = { name: 'Apex Industrial Holdings' } }, 'ap.vendor', 'INSUFFICIENT_DATA', 'abstain', 'AMBIGUOUS_REFERENCE'],
    ['vendor: a look-alike name', (x) => { x.bill.vendor = { name: 'Northfeld Material Handling' } }, 'ap.vendor', 'INSUFFICIENT_DATA', 'abstain', 'AMBIGUOUS_REFERENCE'],
    ['vendor: the bill names none', (x) => { x.bill.vendor = {} }, 'ap.vendor', 'INSUFFICIENT_DATA', 'abstain', 'FIELD_MISSING'],
    // 2026-10-05: the booked row names its order (another PO). With no PO number it might be on this order,
    // which the bill bills in full, so the PO balance check would send it to a person (test/ap-po-balance.test.ts)
    ['duplicate: clean history', (x) => { x.payment_history = [{ invoice_number: 'NM-11111', vendor: 'Northfield Material Handling', purchase_order_number: 'PO-40000', amount: 100 }] }, 'ap.duplicate', 'PASS', 'approve'],
    ['duplicate: already paid', (x) => { x.payment_history = [{ invoice_number: 'nm-84665 ', vendor: 'Northfield Material Handling', amount: 2695, paid_at: '2026-09-01' }] }, 'ap.duplicate', 'FAIL', 'hold_duplicate'],
    ['duplicate: same PO and total under a new number', (x) => { x.payment_history = [{ invoice_number: 'NM-84600', vendor: 'Northfield Material Handling', purchase_order_number: 'PO-48825', amount: { amount: 269500, currency_code: 'USD' } }] }, 'ap.duplicate', 'INSUFFICIENT_DATA', 'abstain', 'AMBIGUOUS_REFERENCE'],
  ]
  for (const [name, f, id, outcome, decision, reason] of rows) {
    it(`${name}: ${id} ${outcome} → ${decision}`, () => {
      const r = plant(f)
      const c = claim(r, id)
      expect(c?.outcome).toBe(outcome)
      if (reason) expect(c?.insufficiency?.reason).toBe(reason)
      expect(r.decision).toBe(decision)
      if (outcome !== 'PASS') {
        const rem = (r.verdict.remedies ?? []).filter((m) => m.claims.includes(id))
        expect(rem.length, 'a non-PASS claim carries a remedy').toBeGreaterThan(0)
      }
      // an approve carries no remedy for any check but the duplicate check
      if (decision === 'approve') expect((r.verdict.remedies ?? []).filter((m) => m.claims.some((c) => c !== 'ap.duplicate'))).toEqual([])
    })
  }
  it('every rule is planted to FAIL and to ABSTAIN somewhere above (the one exception is said)', () => {
    const seen = new Set<string>()
    for (const [, f, id, outcome] of rows) { const r = plant(f); seen.add(`${claim(r, id)!.rule_id}:${outcome}`) }
    for (const rule of ['AP_DUPLICATE', 'AP_QTY_RECEIVED', 'AP_PRICE_PO', 'AP_LINE_MATH', 'AP_TOTAL_SUM']) {
      for (const o of ['PASS', 'FAIL', 'INSUFFICIENT_DATA']) expect(seen.has(`${rule}:${o}`), `${rule}:${o}`).toBe(true)
    }
    // AP_PO_MATCH cannot abstain on structured input: the PO number is a stated field, present or absent, never misread.
    expect(claim(run(base()), 'ap.po_number')?.outcome).toBe('PASS')
    expect(seen.has('AP_PO_MATCH:FAIL')).toBe(true)
  })
  it('the grounding a clerk acts on names the item and both values', () => {
    const r = plant((x) => { x.bill.line_items[1]!.unit_price = 14.61; x.bill.line_items[1]!.amount = 146.1; x.bill.amount = 2698.6 })
    expect(r.grounding).toEqual({ invoice_number: 'NM-84665', po_number: 'PO-48825', item: 'Floor marking tape, yellow', invoiced: 14.61, expected: 14.25 })
    expect(r.verdict.remedies?.find((m) => m.kind === 'authority')?.authority).toBe('buyer')
  })
})

describe('line matching: by PO line id, else SKU, else ABSTAIN — never by text', () => {
  it('a bill line naming no PO line abstains, with a missing-operand remedy naming the field to fill', () => {
    const x = base()
    delete x.bill.line_items[1]!.purchase_order_line_item_id
    const r = run(x)
    expect(r.decision).toBe('abstain')
    for (const k of ['quantity', 'price', 'amount']) {
      const c = claim(r, `ap.bill_line[2].${k}`)!
      expect(c.outcome).toBe('INSUFFICIENT_DATA')
      expect(c.insufficiency).toMatchObject({ reason: 'AMBIGUOUS_REFERENCE', missing: ['purchase_order_line_item_id'] })
    }
    const fix = r.verdict.remedies!.find((m) => m.kind === 'missing-operand' && m.operand?.path === '/bill/line_items/1/purchase_order_line_item_id')
    expect(fix).toBeDefined()
    expect(fix!.detail).toMatch(/Name the PO line/)
    expect(r.not_checked).toContain('PO line 2 (pol-2) is not billed on this bill: nothing to check against it')
  })
  it('a SKU naming exactly one PO line matches; one naming two abstains', () => {
    const x = base()
    x.purchase_order.line_items.forEach((l, i) => { l.sku = `SKU-${i + 1}` })
    x.bill.line_items.forEach((l, i) => { delete l.purchase_order_line_item_id; l.sku = `sku-${i + 1}` })
    x.payment_history = [] // a known, empty book (engine 0.6.0 approves only against one)
    expect(run(x).decision).toBe('approve')
    x.purchase_order.line_items[2]!.sku = 'SKU-2'
    const r = run(x)
    expect(r.decision).toBe('abstain')
    expect(claim(r, 'ap.bill_line[2].quantity')!.insufficiency!.detail).toMatch(/SKU sku-2 is on 2 PO lines/)
  })
  it('two bill lines billing one PO line abstain; a PO line the bill does not bill is listed, not checked', () => {
    const x = base()
    x.bill.line_items[1]!.purchase_order_line_item_id = 'pol-1'
    const r = run(x)
    expect(r.decision).toBe('abstain')
    expect(claim(r, 'ap.bill_line[1].quantity')!.insufficiency!.detail).toMatch(/bill lines 1 and 2 all bill PO line 1/)
    const p = base()
    p.bill.line_items.splice(1, 1)
    p.item_receipts[0]!.line_items.splice(1, 1)
    p.bill.amount = 2552.5
    p.payment_history = [] // a known, empty book (engine 0.6.0 approves only against one)
    const q = run(p)
    expect(q.decision).toBe('approve')
    expect(q.not_checked).toContain('PO line 2 (pol-2) is not billed on this bill: nothing to check against it')
    expect(q.verdict.claims.some((c) => c.claim_id.startsWith('ap.line[2]'))).toBe(false)
  })
})

describe('proof: pointers resolve, the verdict replays, the forms of money agree', () => {
  const all = (): ApStructuredInput[] => {
    const xs = [base()]
    const a = base(); a.bill.amount = { amount: 269500, currency_code: 'USD' }; a.bill.line_items[0]!.unit_price = '47.30'; xs.push(a)
    const b = base(); b.payment_history = [{ invoice_number: 'NM-84665', amount: 2695 }]; xs.push(b)
    const c = base(); c.bill.freight = 40; c.bill.amount = 2735; c.bill.tax = '0.00'; xs.push(c)
    return xs
  }
  it('every evidence locator is a JSON Pointer that resolves into the input, and its value is the value checked', () => {
    let n = 0
    for (const x of all()) {
      const docs = apInputDocuments(x)
      for (const c of run(x).verdict.claims) {
        for (const e of c.evidence) {
          expect(e.locator.kind).toBe('field')
          if (e.locator.kind !== 'field') continue
          const v = resolvePointer(docs, e.locator.path)
          expect(v, e.locator.path).not.toBeUndefined()
          if (e.original === undefined) { if (typeof v !== 'object') expect(v).toEqual(e.value) }
          else expect(e.original).toEqual(typeof v === 'object' ? canonicalize(v) : v)
          n++
        }
      }
    }
    expect(n).toBeGreaterThan(40)
  })
  it('the proof replays: REPERFORMED and outcome_verified; a flipped outcome fails; the reading names the gate decision', () => {
    for (const x of all()) {
      const r = run(x)
      const inputs = { ap_structured: apInputDocuments(x), policy: { price_tolerance: 0.02, total_tolerance: 0.005 } }
      const ok = verifyReplay(r.verdict, inputs)
      expect(ok.status).toBe('REPERFORMED')
      expect(ok.outcome_verified).toBe(true)
      expect(replayReading(r.verdict, inputs).gate?.decision).toBe(r.decision)
      const bad = verifyReplay({ ...r.verdict, outcome: r.verdict.outcome === 'PASS' ? 'FAIL' : 'PASS' }, inputs)
      expect(bad.ok).toBe(false)
    }
  })
  it('the book holds a structured verdict to its line recompute (a line FAIL flipped to PASS is caught)', () => {
    const x = base(); x.bill.line_items[1]!.amount = 152.5; x.bill.amount = 2705
    const v = clone(run(x).verdict)
    expect(apLineMathProblem(v)).toBeUndefined()
    const c = v.claims.find((k) => k.claim_id === 'ap.line[2].amount')!
    c.outcome = 'PASS'
    expect(apLineMathProblem(v)).toMatch(/ap.line\[2\].amount is PASS, but its own operands recompute to FAIL/)
  })
  it('deterministic: the same facts give the same verdict, whatever the key order; money forms change the id, not the answer', () => {
    const a = run(base())
    const reverseKeys = (v: unknown): unknown => Array.isArray(v) ? v.map(reverseKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse().map(([k, w]) => [k, reverseKeys(w)])) : v
    const shuffled = reverseKeys(base())
    expect(JSON.stringify(shuffled)).not.toBe(JSON.stringify(base()))
    expect(run(shuffled).verdict.verdict_id).toBe(a.verdict.verdict_id)
    expect(hashOf(run(base()).verdict)).toBe(hashOf(a.verdict))
    const m = base(); m.bill.amount = { amount: '269500', currency_code: 'USD' }
    m.bill.line_items = m.bill.line_items.map((l) => ({ ...l, unit_price: String(l.unit_price), amount: { amount: Math.round(Number(l.amount) * 100), currency_code: 'USD' } }))
    const b = run(m)
    expect(b.verdict.verdict_id).not.toBe(a.verdict.verdict_id)
    expect(projection(b)).toEqual(projection(a))
  })
  it('the model decision is not part of the verdict: the same documents with "pay" or "hold" give one verdict id', () => {
    const p = base(); p.decision = { action: 'pay', confidence: 0.99 }
    const h = base(); h.decision = { action: 'hold', reason: 'hold_price' }
    expect(run(p).verdict.verdict_id).toBe(run(h).verdict.verdict_id)
    expect(run(p).verdict.verdict_id).toBe(run(base()).verdict.verdict_id)
  })
})

describe('CLI: verify ap --input', () => {
  const cli = async (args: string[]) => {
    const { run: main } = await import('../src/cli')
    let out = '', err = ''
    const code = main(args, { out: (s: string) => { out += s }, err: (s: string) => { err += s } })
    return { code, out, err }
  }
  const file = (x: unknown): string => { const d = mkdtempSync(join(tmpdir(), 'ap-s1-')); const f = join(d, 'in.json'); writeFileSync(f, JSON.stringify(x)); return f }
  it('approve exits 0, a hold 1, an abstain 2; the printed proof replays through verify replay', async () => {
    const none = await cli(['ap', '--input', file(base())]) // no payment history: the duplicate check did not run, a person decides
    expect(none.code).toBe(2)
    expect(JSON.parse(none.out)).toMatchObject({ decision: 'abstain', payable: false })
    const ok = await cli(['ap', '--input', file({ ...base(), payment_history: [] })])
    expect(ok.code).toBe(0)
    const res = JSON.parse(ok.out)
    expect(res.decision).toBe('approve')
    expect(res.proof.inputs.ap_structured.bill.invoice_number).toBe('NM-84665')
    const bundle = file({ verdict: res.proof.verdict, inputs: res.proof.inputs })
    const rp = await cli(['replay', bundle])
    expect(rp.code).toBe(0)
    const hold = base(); hold.bill.amount = 2705
    expect((await cli(['ap', '--input', file(hold)])).code).toBe(1)
    const abs = base(); abs.bill.currency = 'EUR'
    expect((await cli(['ap', '--input', file(abs)])).code).toBe(2)
  })
  it('input that does not validate: exit 3, typed errors naming the field on stderr, nothing on stdout', async () => {
    const x = base() as any; x.bill.line_items[0].quantiy = 1
    const r = await cli(['ap', '--input', file(x)])
    expect(r.code).toBe(3)
    expect(r.out).toBe('')
    expect(JSON.parse(r.err).errors).toContainEqual(expect.objectContaining({ code: 'ap_input.unknown_field', field: '/bill/line_items/0/quantiy' }))
  })
})
