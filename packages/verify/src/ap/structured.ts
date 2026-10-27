/**
 * AP three-way match on STRUCTURED input (2026-10-03): a bill, its purchase order and its item receipts as JSON — the
 * shape an ERP or a spend platform already holds — instead of three texts. Ruleset `ap-structured@0.1.0`; the text path
 * (./index.ts, `ap-threeway`) is unchanged, and no existing ruleset id moves.
 *
 * The same checks, rule ids, claim ids, remedies (AP_REMEDIES) and policy decision (./decide.ts) as the text path:
 *   ap.duplicate          (only with payment_history) not already booked; same vendor + PO + total under a new number abstains.
 *                         Engine 0.6.0 (./duplicate.ts): vendors compared by tax id, vendor id, then normalized name, so the same
 *                         number under a vendor variant holds; without payment_history the claim is stated as not run
 *   ap.po_number          bill.purchase_order_number === purchase_order.purchase_order_number (exact, after trimming)
 *   ap.line[L].quantity   billed quantity ≤ received quantity (summed over every item receipt line for that PO line)
 *   ap.line[L].price      bill unit price ≤ PO unit price × (1 + price_tolerance)
 *   ap.line[L].amount     stated line amount = quantity × unit price, within one minor unit
 *   ap.total              stated bill amount = Σ line amounts (+ freight only if the PO allows it) (+ tax, summed, not rated)
 *   ap.po_balance         (engine 0.6.0, only with payment_history; ./po-balance.ts) booked on this PO + this bill's lines ≤
 *                         Σ PO line quantity × unit price; over → a person decides
 *   ap.vendor             (engine 0.6.0; ./vendor.ts) bill.vendor is purchase_order.vendor, by the duplicate
 *                         check's ladder (tax id, vendor id, normalized name); otherwise a person decides, naming both. A PO
 *                         that names no vendor: not run, said in not_checked
 *   ap.tax                (engine 0.6.0; ./tax.ts; only when the bill carries tax) the tax is what the PO's
 *                         tax_rate allows on its taxable lines; a PO silent on tax → a person decides; a stated rate of 0 →
 *                         hold_total
 *   ap.line[L].billed_to_date (engine 0.6.0; ./qty-to-date.ts; only when the PO line carries
 *                         invoiced_quantity_to_date) earlier bills' quantity + this bill's ≤ received; over → a person decides
 *   The tax check reads the run's tax policy (policy.tax: 'allow' or { rate }) when the PO states no tax terms (2026-10-06).
 * L is the PO line's 1-based position in purchase_order.line_items.
 *
 * What structured mode does differently, on purpose:
 *   - Lines match by purchase_order_line_item_id, else by a SKU that names exactly one PO line, else ABSTAIN: no fuzzy text
 *     matching. A bill line that matches no PO line gets claims `ap.bill_line[n].*` (n = its 1-based position), can't-tell,
 *     with a missing-operand remedy naming the field to fill.
 *   - A PO line the bill does not bill is not checked (partial billing is ordinary); it is listed in not_checked.
 *   - A bill and a PO in different currencies: unit prices are not compared (can't-tell, AMBIGUOUS_UNIT).
 *   - Evidence locators are JSON Pointers (RFC 6901) into the input, e.g. `/bill/line_items/0/quantity`.
 * Three-way matching itself is decades old (ERP match-and-hold); what this adds is the proof object and the typed remedies.
 *
 * Input validation is typed: every error names its field as a JSON Pointer and carries a stable code (ApInputErrorCode).
 * The JSON Schema (./ap-input-schema.ts, docs/ap-input.schema.json) states the shape; this validator also checks what a schema
 * cannot: unique PO line ids, receipt lines naming PO lines, one currency per document, caps.
 *
 * Deterministic; no I/O; no clock except issued_at.
 */
import { canonicalize, hashOf, sha256 } from '../verdict/canonical.js'
import { attachRemedies } from '../verdict/remedy.js'
import { attachScope } from '../verdict/scope.js'
import type { ClaimVerdict, Coverage, Evidence, EvidenceSource, Outcome, Verdict } from '../verdict/schema.js'
import { SCHEMA_VERSION, engineAtLeast, engineFor } from '../version.js'
import { verdictIdentity } from '../protocol/verdict-id.js'
import { apPolicyDecision } from './decide.js'
import { apFreightByPolicy, apPolicyOf, apRemediesFor, apTaxByPolicy, type ApPolicy, type ApResult, type PriorInvoice } from './index.js'
import { duplicateClaimV060, noHistoryClaim, NO_HISTORY_DETAIL, normalizeTaxId, normalizeVendorName, type BookedInvoice } from './duplicate.js'
import { AP_LINE_MATH_RULE, minorUnitDigits, recomputeLine } from './line-math.js'
import { close, round2 } from './parse.js'
import { PO_BALANCE_NOT_RUN, bookedOnOrder, perLineGapNote, poBalanceClaim } from './po-balance.js'
import { qtyToDateClaim } from './qty-to-date.js'
import { BANK_NOT_CHECKED_STRUCTURED } from './remittance.js'
import { taxClaim, taxNotChecked } from './tax.js'
import { structuredVendorNotChecked, vendorClaimStructured } from './vendor.js'
import { totalWords } from './words.js'
import { readsAs070 } from './v070.js'

export const AP_STRUCTURED_RULESET = { id: 'ap-structured', version: '0.1.0', domain: 'accounts-payable' } as const
export type ApStructuredRuleset = typeof AP_STRUCTURED_RULESET
/** The input document's own version tag (the `schema` field). */
export const AP_INPUT_VERSION = 'riposte.ap-input/0.1.0'
export const AP_INPUT_LIMITS = { lines: 1_000, receipts: 1_000, receipt_lines: 10_000, history: 10_000, id: 256, text: 1_024, rationale: 4_000, errors: 50 } as const

// ── the input ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A money value: a JSON number or a decimal string in major units ("1234.50"), or minor units with a currency (Ramp's CurrencyAmount). */
export type ApMoney = number | string | { amount: number | string; currency_code?: string; minor_unit_conversion_rate?: number | null }
/** A quantity: a non-negative JSON number or decimal string. */
export type ApQuantity = number | string

/** `tax_id` (2026-10-05, optional): the vendor's tax id (EIN, VAT number). Under engine 0.6.0 the duplicate check compares it, then `id`, then the name. */
export interface ApVendor { id?: string | null; name?: string | null; tax_id?: string | null }
export interface ApBillLine {
  id?: string | null
  /** the PO line this bill line bills (Ramp: purchase_order_line_item_id) */
  purchase_order_line_item_id?: string | null
  sku?: string | null
  description?: string | null
  memo?: string | null
  quantity?: ApQuantity | null
  unit_price?: ApMoney | null
  amount: ApMoney
  discount_amount?: ApMoney | null
  discount_rate?: number | string | null
}
export interface ApBill {
  id?: string | null
  invoice_number: string
  vendor: ApVendor
  purchase_order_number?: string | null
  currency?: string | null
  /** the stated total (Ramp: Bill.amount) */
  amount: ApMoney
  freight?: ApMoney | null
  tax?: ApMoney | null
  issued_at?: string | null
  line_items: ApBillLine[]
}
export interface ApPoLine {
  id: string
  sku?: string | null
  external_id?: string | null
  description?: string | null
  quantity?: ApQuantity | null
  unit_price: ApMoney
  amount?: ApMoney | null
  /** 2026-10-05, optional: false = this line is not taxed; absent or true = taxed when the PO states a tax_rate */
  taxable?: boolean | null
  /**
   * 2026-10-06, optional: the quantity already invoiced on this PO line by EARLIER bills, not counting this one
   * (job-cost ERPs keep it per PO line). Present: this bill's quantity is netted against it (./qty-to-date.ts). Absent: the
   * per-line netting gap is named under "Not checked" when an earlier bill is booked on the order.
   */
  invoiced_quantity_to_date?: ApQuantity | null
}
export interface ApPurchaseOrder {
  id?: string | null
  purchase_order_number: string
  vendor?: ApVendor | null
  currency?: string | null
  /** whether freight may be billed on top of the lines; absent = the PO does not say */
  freight_allowed?: boolean | null
  /**
   * 2026-10-05, optional: the PO's tax terms, a fraction from 0 to 1 (0.0825 is 8.25%). 0 states that no tax
   * is due (tax billed then holds, hold_total); absent = the PO does not say (tax billed then goes to a person).
   */
  tax_rate?: number | null
  line_items: ApPoLine[]
}
export interface ApReceiptLine { id?: string | null; purchase_order_line_item_id: string; quantity: ApQuantity }
export interface ApItemReceipt { id?: string | null; item_receipt_number?: string | null; purchase_order_id?: string | null; received_at?: string | null; line_items: ApReceiptLine[] }
/** `vendor_id` and `vendor_tax_id` (2026-10-05, optional): the vendor the invoice was booked under, by vendor-master id and tax id. Under engine 0.6.0 the duplicate check prefers them to the name. */
/** `no_purchase_order` (2026-10-05, optional): true when the invoice was booked without a PO; the PO balance check then does not count it against any order. */
export interface ApPayment { invoice_number: string; vendor?: string | null; vendor_id?: string | null; vendor_tax_id?: string | null; purchase_order_number?: string | null; no_purchase_order?: boolean | null; amount?: ApMoney | null; paid_at?: string | null }
export const AP_HOLD_REASONS = ['hold_duplicate', 'hold_no_po', 'hold_quantity', 'hold_price', 'hold_line_math', 'hold_total'] as const
export type ApHoldReason = (typeof AP_HOLD_REASONS)[number]
export interface ApModelDecision { action: 'pay' | 'hold'; reason?: ApHoldReason | null; confidence?: number | null; rationale?: string | null; model?: string | null }

export interface ApStructuredInput {
  schema: typeof AP_INPUT_VERSION
  bill: ApBill
  purchase_order: ApPurchaseOrder
  item_receipts: ApItemReceipt[]
  /** OPTIONAL: invoices already booked or paid. Enables the duplicate check. */
  payment_history?: ApPayment[] | null
  /** OPTIONAL: the model's decision. Not part of the verdict's inputs (the verdict is about the documents). */
  decision?: ApModelDecision | null
}
/** The documents the verdict is about: the input without the model's decision. */
export type ApStructuredDocuments = Omit<ApStructuredInput, 'decision'>

export const isApStructured = (x: unknown): x is ApStructuredInput | ApStructuredDocuments =>
  typeof x === 'object' && x !== null && !Array.isArray(x) && 'bill' in x && 'purchase_order' in x

/** The input without `decision`: what a verdict's input_hash commits to, and what a proof carries. */
export function apInputDocuments(x: ApStructuredInput | ApStructuredDocuments): ApStructuredDocuments {
  const { decision: _d, ...docs } = x as ApStructuredInput
  return docs
}

/**
 * The proof inside a file `verify ap --input` wrote (2026-10-06): its `proof` member ({ verdict, inputs }), which `verify
 * replay` re-performs, and whether the file's own top-level verdict is that proof's verdict (`same`). Null for anything else: a
 * bundle with its own inputs, a bare verdict, an envelope.
 */
export function apProofOf(x: unknown): { proof: { verdict: unknown; inputs: unknown }; same: boolean } | null {
  if (!isObj(x) || x.inputs !== undefined || !isObj(x.proof)) return null
  const p = x.proof
  if (!isObj(p.verdict) || p.inputs === undefined || !isObj(p.inputs)) return null
  const same = x.verdict === undefined || canonicalize(x.verdict) === canonicalize(p.verdict)
  return { proof: { verdict: p.verdict, inputs: p.inputs }, same }
}

/** The model's decision as the gate's label: pay → approve; hold → its reason, or the generic 'hold'. */
export function apDecisionLabel(d: ApModelDecision): string {
  return d.action === 'pay' ? 'approve' : d.reason ?? 'hold'
}

// ── validation ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export type ApInputErrorCode =
  | 'ap_input.not_object' | 'ap_input.schema_version' | 'ap_input.missing_field' | 'ap_input.unknown_field' | 'ap_input.wrong_type'
  | 'ap_input.invalid_money' | 'ap_input.invalid_quantity' | 'ap_input.invalid_enum' | 'ap_input.out_of_range' | 'ap_input.too_many'
  | 'ap_input.too_long' | 'ap_input.currency_conflict' | 'ap_input.currency_missing' | 'ap_input.duplicate_id' | 'ap_input.reference_unknown'
  | 'ap_input.conflict'
/** One validation error: a stable code, the field as a JSON Pointer into the input, and English for people. */
export interface ApInputError { code: ApInputErrorCode; field: string; message: string }
export type ApInputCheck = { ok: true; input: ApStructuredInput } | { ok: false; errors: ApInputError[] }

/** Thrown by verifyBillMatch on an input that does not validate; `errors` names every field. */
export class ApInputInvalid extends Error {
  readonly errors: ApInputError[]
  constructor(errors: ApInputError[]) {
    super(`the AP input does not validate: ${errors.slice(0, 3).map((e) => `${e.field || '/'} ${e.message}`).join('; ')}${errors.length > 3 ? ` (+${errors.length - 3} more)` : ''}`)
    this.name = 'ApInputInvalid'
    this.errors = errors
  }
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const esc = (k: string | number): string => String(k).replace(/~/g, '~0').replace(/\//g, '~1')
const at = (base: string, k: string | number): string => `${base}/${esc(k)}`
const DECIMAL = /^-?[0-9]{1,15}(\.[0-9]{1,6})?$/
const NONNEG_DECIMAL = /^[0-9]{1,15}(\.[0-9]{1,6})?$/
const MINOR_INT = /^-?[0-9]{1,17}$/
const CURRENCY = /^[A-Z]{3}$/
const MONEY_MAX = 1e12
const RATES = new Set([1, 10, 100, 1_000, 10_000])

class Errors {
  readonly list: ApInputError[] = []
  add(code: ApInputErrorCode, field: string, message: string): void { if (this.list.length < AP_INPUT_LIMITS.errors) this.list.push({ code, field, message }) }
  get full(): boolean { return this.list.length >= AP_INPUT_LIMITS.errors }
}

type Spec = Record<string, boolean> // field → required

/** An object with exactly the listed fields; null on a required field is missing. */
function objectOf(e: Errors, x: unknown, where: string, spec: Spec, what: string): x is Record<string, unknown> {
  if (!isObj(x)) { e.add(where === '' ? 'ap_input.not_object' : 'ap_input.wrong_type', where, `${what} must be a JSON object`); return false }
  for (const k of Object.keys(x)) if (!(k in spec)) e.add('ap_input.unknown_field', at(where, k), `"${k}" is not a field of ${what}`)
  for (const [k, req] of Object.entries(spec)) if (req && (x[k] === undefined || x[k] === null)) e.add('ap_input.missing_field', at(where, k), `${what} needs "${k}"`)
  return true
}
const present = (x: unknown): boolean => x !== undefined && x !== null

function stringAt(e: Errors, x: unknown, where: string, max: number, nonEmpty: boolean): void {
  if (!present(x)) return
  if (typeof x !== 'string') return e.add('ap_input.wrong_type', where, 'must be a string')
  if (nonEmpty && !x.trim()) return e.add('ap_input.missing_field', where, 'must not be empty')
  if (x.length > max) e.add('ap_input.too_long', where, `is ${x.length} characters; at most ${max}`)
}
function currencyAt(e: Errors, x: unknown, where: string): void {
  if (!present(x)) return
  if (typeof x !== 'string' || !CURRENCY.test(x)) e.add('ap_input.invalid_enum', where, 'must be an ISO 4217 code, three capital letters ("USD")')
}
function moneyAt(e: Errors, x: unknown, where: string, nonNegative: boolean): void {
  if (!present(x)) return
  const sign = nonNegative ? ' a non-negative' : ''
  if (typeof x === 'number') {
    if (!Number.isFinite(x)) return e.add('ap_input.invalid_money', where, 'must be a finite number')
    if (Math.abs(x) > MONEY_MAX) return e.add('ap_input.out_of_range', where, `is beyond ±${MONEY_MAX}`)
    if (nonNegative && x < 0) e.add('ap_input.out_of_range', where, 'must not be negative')
    return
  }
  if (typeof x === 'string') {
    if (!(nonNegative ? NONNEG_DECIMAL : DECIMAL).test(x)) e.add('ap_input.invalid_money', where, `must be${sign} decimal string in major units ("1234.50"), at most 15 digits and 6 decimals`)
    return
  }
  if (isObj(x)) {
    if (!objectOf(e, x, where, { amount: true, currency_code: false, minor_unit_conversion_rate: false }, 'a minor-unit amount')) return
    const a = x.amount
    const okInt = (typeof a === 'number' && Number.isSafeInteger(a)) || (typeof a === 'string' && MINOR_INT.test(a))
    if (present(a) && !okInt) e.add('ap_input.invalid_money', at(where, 'amount'), 'must be an integer number of minor units (cents for USD)')
    else if (nonNegative && present(a) && Number(a) < 0) e.add('ap_input.out_of_range', at(where, 'amount'), 'must not be negative')
    currencyAt(e, x.currency_code, at(where, 'currency_code'))
    const r = x.minor_unit_conversion_rate
    if (present(r) && !(typeof r === 'number' && RATES.has(r))) e.add('ap_input.out_of_range', at(where, 'minor_unit_conversion_rate'), 'must be 1, 10, 100, 1000 or 10000')
    return
  }
  e.add('ap_input.invalid_money', where, 'must be a number, a decimal string, or { amount, currency_code } in minor units')
}
function quantityAt(e: Errors, x: unknown, where: string): void {
  if (!present(x)) return
  if (typeof x === 'number') {
    if (!Number.isFinite(x) || x < 0 || x > MONEY_MAX) e.add('ap_input.invalid_quantity', where, 'must be a finite, non-negative number')
    return
  }
  if (typeof x === 'string' && NONNEG_DECIMAL.test(x)) return
  e.add('ap_input.invalid_quantity', where, 'must be a non-negative number or decimal string')
}
function arrayAt(e: Errors, x: unknown, where: string, max: number, min: number): x is unknown[] {
  if (!Array.isArray(x)) { if (present(x)) e.add('ap_input.wrong_type', where, 'must be an array'); return false }
  if (x.length > max) { e.add('ap_input.too_many', where, `holds ${x.length}; at most ${max}`); return false }
  if (x.length < min) { e.add('ap_input.missing_field', where, `needs at least ${min}`); return false }
  return true
}
function vendorAt(e: Errors, x: unknown, where: string): void {
  if (!present(x)) return
  if (!objectOf(e, x, where, { id: false, name: false, tax_id: false }, 'a vendor')) return
  stringAt(e, x.id, at(where, 'id'), AP_INPUT_LIMITS.id, true)
  stringAt(e, x.name, at(where, 'name'), AP_INPUT_LIMITS.text, true)
  stringAt(e, x.tax_id, at(where, 'tax_id'), AP_INPUT_LIMITS.id, true)
}

/** The currency code a money value names, if it names one. */
const codeOf = (m: unknown): string | undefined => (isObj(m) && typeof m.currency_code === 'string' ? m.currency_code : undefined)

/** Validate an AP input. Never throws. On success the input is returned as given (validated, not copied). */
export function validateApInput(x: unknown): ApInputCheck {
  const e = new Errors()
  if (!objectOf(e, x, '', { schema: true, bill: true, purchase_order: true, item_receipts: true, payment_history: false, decision: false }, 'the AP input')) return { ok: false, errors: e.list }
  if (present(x.schema) && x.schema !== AP_INPUT_VERSION) e.add('ap_input.schema_version', '/schema', `must be "${AP_INPUT_VERSION}" (this build reads that version)`)
  const L = AP_INPUT_LIMITS

  // bill
  const b = x.bill
  if (present(b) && objectOf(e, b, '/bill', { id: false, invoice_number: true, vendor: true, purchase_order_number: false, currency: false, amount: true, freight: false, tax: false, issued_at: false, line_items: true }, 'the bill')) {
    stringAt(e, b.id, '/bill/id', L.id, true)
    stringAt(e, b.invoice_number, '/bill/invoice_number', L.id, true)
    vendorAt(e, b.vendor, '/bill/vendor')
    stringAt(e, b.purchase_order_number, '/bill/purchase_order_number', L.id, true)
    currencyAt(e, b.currency, '/bill/currency')
    moneyAt(e, b.amount, '/bill/amount', false)
    moneyAt(e, b.freight, '/bill/freight', false)
    moneyAt(e, b.tax, '/bill/tax', false)
    stringAt(e, b.issued_at, '/bill/issued_at', 64, true)
    if (arrayAt(e, b.line_items, '/bill/line_items', L.lines, 1)) {
      b.line_items.forEach((l, i) => {
        const w = `/bill/line_items/${i}`
        if (e.full || !objectOf(e, l, w, { id: false, purchase_order_line_item_id: false, sku: false, description: false, memo: false, quantity: false, unit_price: false, amount: true, discount_amount: false, discount_rate: false }, 'a bill line')) return
        stringAt(e, l.id, at(w, 'id'), L.id, true)
        stringAt(e, l.purchase_order_line_item_id, at(w, 'purchase_order_line_item_id'), L.id, true)
        stringAt(e, l.sku, at(w, 'sku'), L.id, true)
        stringAt(e, l.description, at(w, 'description'), L.text, false)
        stringAt(e, l.memo, at(w, 'memo'), L.text, false)
        quantityAt(e, l.quantity, at(w, 'quantity'))
        moneyAt(e, l.unit_price, at(w, 'unit_price'), true)
        moneyAt(e, l.amount, at(w, 'amount'), false)
        moneyAt(e, l.discount_amount, at(w, 'discount_amount'), false)
        if (present(l.discount_rate) && !((typeof l.discount_rate === 'number' && Number.isFinite(l.discount_rate)) || (typeof l.discount_rate === 'string' && DECIMAL.test(l.discount_rate)))) {
          e.add('ap_input.wrong_type', at(w, 'discount_rate'), 'must be a number or decimal string')
        }
      })
    }
  }

  // purchase order
  const p = x.purchase_order
  const poIds = new Map<string, number>()
  if (present(p) && objectOf(e, p, '/purchase_order', { id: false, purchase_order_number: true, vendor: false, currency: false, freight_allowed: false, tax_rate: false, line_items: true }, 'the purchase order')) {
    stringAt(e, p.id, '/purchase_order/id', L.id, true)
    stringAt(e, p.purchase_order_number, '/purchase_order/purchase_order_number', L.id, true)
    vendorAt(e, p.vendor, '/purchase_order/vendor')
    currencyAt(e, p.currency, '/purchase_order/currency')
    if (present(p.freight_allowed) && typeof p.freight_allowed !== 'boolean') e.add('ap_input.wrong_type', '/purchase_order/freight_allowed', 'must be true, false, or absent (the PO does not say)')
    // 2026-10-05: a fraction, never a percent written as a bare number (8.25 is refused: 0.0825 is 8.25%)
    if (present(p.tax_rate) && (typeof p.tax_rate !== 'number' || !Number.isFinite(p.tax_rate))) e.add('ap_input.wrong_type', '/purchase_order/tax_rate', 'must be a number: the tax rate as a fraction (0.0825 is 8.25%; 0 states that no tax is due), or absent (the PO does not say)')
    else if (present(p.tax_rate) && !((p.tax_rate as number) >= 0 && (p.tax_rate as number) <= 1)) e.add('ap_input.out_of_range', '/purchase_order/tax_rate', `is ${String(p.tax_rate)}; a tax rate is a fraction from 0 to 1 (0.0825 is 8.25%)`)
    if (arrayAt(e, p.line_items, '/purchase_order/line_items', L.lines, 1)) {
      p.line_items.forEach((l, i) => {
        const w = `/purchase_order/line_items/${i}`
        if (e.full || !objectOf(e, l, w, { id: true, sku: false, external_id: false, description: false, quantity: false, unit_price: true, amount: false, taxable: false, invoiced_quantity_to_date: false }, 'a purchase-order line')) return
        quantityAt(e, l.invoiced_quantity_to_date, at(w, 'invoiced_quantity_to_date')) // 2026-10-06
        if (present(l.taxable) && typeof l.taxable !== 'boolean') e.add('ap_input.wrong_type', at(w, 'taxable'), 'must be true, false, or absent (taxed when the PO states a tax_rate)')
        stringAt(e, l.id, at(w, 'id'), L.id, true)
        if (typeof l.id === 'string' && l.id.trim()) {
          if (poIds.has(l.id)) e.add('ap_input.duplicate_id', at(w, 'id'), `PO line id "${l.id}" is also line ${poIds.get(l.id)! + 1}: each PO line needs its own id`)
          else poIds.set(l.id, i)
        }
        stringAt(e, l.sku, at(w, 'sku'), L.id, true)
        stringAt(e, l.external_id, at(w, 'external_id'), L.id, true)
        stringAt(e, l.description, at(w, 'description'), L.text, false)
        quantityAt(e, l.quantity, at(w, 'quantity'))
        moneyAt(e, l.unit_price, at(w, 'unit_price'), true)
        moneyAt(e, l.amount, at(w, 'amount'), false)
      })
    }
  }

  // item receipts
  const r = x.item_receipts
  if (present(r) && arrayAt(e, r, '/item_receipts', L.receipts, 0)) {
    let n = 0
    r.forEach((rc, i) => {
      const w = `/item_receipts/${i}`
      if (e.full || !objectOf(e, rc, w, { id: false, item_receipt_number: false, purchase_order_id: false, received_at: false, line_items: true }, 'an item receipt')) return
      stringAt(e, rc.id, at(w, 'id'), L.id, true)
      stringAt(e, rc.item_receipt_number, at(w, 'item_receipt_number'), L.id, true)
      stringAt(e, rc.purchase_order_id, at(w, 'purchase_order_id'), L.id, true)
      stringAt(e, rc.received_at, at(w, 'received_at'), 64, true)
      if (isObj(p) && typeof p.id === 'string' && typeof rc.purchase_order_id === 'string' && rc.purchase_order_id !== p.id) {
        e.add('ap_input.reference_unknown', at(w, 'purchase_order_id'), `this receipt belongs to purchase order "${rc.purchase_order_id}", not to "${p.id}"`)
      }
      if (!arrayAt(e, rc.line_items, at(w, 'line_items'), L.lines, 1)) return
      n += rc.line_items.length
      rc.line_items.forEach((l, j) => {
        const lw = `${w}/line_items/${j}`
        if (e.full || !objectOf(e, l, lw, { id: false, purchase_order_line_item_id: true, quantity: true }, 'an item-receipt line')) return
        stringAt(e, l.id, at(lw, 'id'), L.id, true)
        stringAt(e, l.purchase_order_line_item_id, at(lw, 'purchase_order_line_item_id'), L.id, true)
        quantityAt(e, l.quantity, at(lw, 'quantity'))
        if (typeof l.purchase_order_line_item_id === 'string' && poIds.size && !poIds.has(l.purchase_order_line_item_id)) {
          e.add('ap_input.reference_unknown', at(lw, 'purchase_order_line_item_id'), `names PO line "${l.purchase_order_line_item_id}", which is not on the purchase order`)
        }
      })
    })
    if (n > L.receipt_lines) e.add('ap_input.too_many', '/item_receipts', `${n} receipt lines in all; at most ${L.receipt_lines}`)
  }

  // payment history
  const h = x.payment_history
  if (present(h) && arrayAt(e, h, '/payment_history', L.history, 0)) {
    h.forEach((pay, i) => {
      const w = `/payment_history/${i}`
      if (e.full || !objectOf(e, pay, w, { invoice_number: true, vendor: false, vendor_id: false, vendor_tax_id: false, purchase_order_number: false, no_purchase_order: false, amount: false, paid_at: false }, 'a payment-history row')) return
      stringAt(e, pay.invoice_number, at(w, 'invoice_number'), L.id, true)
      stringAt(e, pay.vendor, at(w, 'vendor'), L.text, true)
      stringAt(e, pay.vendor_id, at(w, 'vendor_id'), L.id, true)
      stringAt(e, pay.vendor_tax_id, at(w, 'vendor_tax_id'), L.id, true)
      stringAt(e, pay.purchase_order_number, at(w, 'purchase_order_number'), L.id, true)
      if (present(pay.no_purchase_order) && typeof pay.no_purchase_order !== 'boolean') e.add('ap_input.wrong_type', at(w, 'no_purchase_order'), 'must be true, false, or absent')
      if (pay.no_purchase_order === true && present(pay.purchase_order_number)) e.add('ap_input.conflict', at(w, 'no_purchase_order'), 'a row booked without a purchase order carries no purchase_order_number')
      moneyAt(e, pay.amount, at(w, 'amount'), false)
      stringAt(e, pay.paid_at, at(w, 'paid_at'), 64, true)
    })
  }

  // the model's decision
  const d = x.decision
  if (present(d) && objectOf(e, d, '/decision', { action: true, reason: false, confidence: false, rationale: false, model: false }, 'the decision')) {
    if (present(d.action) && d.action !== 'pay' && d.action !== 'hold') e.add('ap_input.invalid_enum', '/decision/action', 'must be "pay" or "hold"')
    if (present(d.reason) && !(AP_HOLD_REASONS as readonly unknown[]).includes(d.reason)) e.add('ap_input.invalid_enum', '/decision/reason', `must be one of ${AP_HOLD_REASONS.join(', ')}`)
    if (d.action === 'pay' && present(d.reason)) e.add('ap_input.conflict', '/decision/reason', 'a "pay" decision carries no hold reason')
    if (present(d.confidence) && !(typeof d.confidence === 'number' && d.confidence >= 0 && d.confidence <= 1)) e.add('ap_input.out_of_range', '/decision/confidence', 'must be a number from 0 to 1')
    stringAt(e, d.rationale, '/decision/rationale', L.rationale, false)
    stringAt(e, d.model, '/decision/model', L.id, true)
  }

  // one currency per document; minor units need one
  if (!e.list.length) {
    const docCurrency = (stated: unknown, monies: [unknown, string][], doc: string): void => {
      let cur = typeof stated === 'string' ? stated : undefined
      let from = stated !== undefined && stated !== null ? `${doc}/currency` : undefined
      for (const [m, w] of monies) {
        const c = codeOf(m)
        if (c === undefined) continue
        if (cur === undefined) { cur = c; from = w; continue }
        if (c !== cur) e.add('ap_input.currency_conflict', `${w}/currency_code`, `is ${c}, but ${from} says ${cur}: one document, one currency`)
      }
      for (const [m, w] of monies) {
        if (isObj(m) && codeOf(m) === undefined && cur === undefined && !present(m.minor_unit_conversion_rate)) {
          e.add('ap_input.currency_missing', w, 'an amount in minor units needs a currency (currency_code here, or the document\'s currency)')
        }
      }
    }
    const bill = x.bill as unknown as ApBill
    docCurrency(bill.currency, [[bill.amount, '/bill/amount'], [bill.freight, '/bill/freight'], [bill.tax, '/bill/tax'],
      ...bill.line_items.flatMap((l, i): [unknown, string][] => [[l.unit_price, `/bill/line_items/${i}/unit_price`], [l.amount, `/bill/line_items/${i}/amount`], [l.discount_amount, `/bill/line_items/${i}/discount_amount`]])], '/bill')
    const po = x.purchase_order as unknown as ApPurchaseOrder
    docCurrency(po.currency, po.line_items.flatMap((l, i): [unknown, string][] => [[l.unit_price, `/purchase_order/line_items/${i}/unit_price`], [l.amount, `/purchase_order/line_items/${i}/amount`]]), '/purchase_order')
    const hist = (x.payment_history ?? []) as ApPayment[]
    hist.forEach((pay, i) => docCurrency(undefined, [[pay.amount, `/payment_history/${i}/amount`]], `/payment_history/${i}`))
  }
  return e.list.length ? { ok: false, errors: e.list } : { ok: true, input: x as unknown as ApStructuredInput }
}

// ── reading values ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** The document's currency: stated, else the first currency_code on any of its amounts, else null. */
function currencyOf(stated: string | null | undefined, monies: unknown[]): string | null {
  if (stated) return stated
  for (const m of monies) { const c = codeOf(m); if (c) return c }
  return null
}

interface Read { value: number; original?: ApMoney; normalizations?: string[] }

/** A validated money value in major units (decimal strings and minor units normalized; the raw value kept as original). */
function money(m: ApMoney, currency: string | null): Read {
  if (typeof m === 'number') return { value: m }
  if (typeof m === 'string') return { value: Number(m), original: m, normalizations: ['decimal_string'] }
  const rate = m.minor_unit_conversion_rate ?? 10 ** minorUnitDigits(m.currency_code ?? currency)
  const v = Number(m.amount) / rate
  return { value: v, original: m, normalizations: [`minor_units_divided_by_${rate}`] }
}
function quantity(q: ApQuantity): Read {
  return typeof q === 'number' ? { value: q } : { value: Number(q), original: q, normalizations: ['decimal_string'] }
}

/** The duplicate index's view of a bill: its number, the vendor (the PO's, else the bill's) and its stated amount. */
export function apInputIdentity(x: ApStructuredInput | ApStructuredDocuments): { invoice_number: string; vendor: string | null; total: number } {
  const cur = currencyOf(x.bill.currency, [x.bill.amount])
  return { invoice_number: x.bill.invoice_number, vendor: x.purchase_order.vendor?.name ?? x.bill.vendor?.name ?? null, total: money(x.bill.amount, cur).value }
}

/** RFC 6901: the value a JSON Pointer names in `doc`, or undefined. */
export function resolvePointer(doc: unknown, pointer: string): unknown {
  if (pointer === '') return doc
  if (!pointer.startsWith('/')) return undefined
  let cur: unknown = doc
  for (const raw of pointer.slice(1).split('/')) {
    const k = raw.replace(/~1/g, '/').replace(/~0/g, '~')
    if (Array.isArray(cur)) { if (!/^(0|[1-9][0-9]*)$/.test(k)) return undefined; cur = cur[Number(k)] }
    else if (isObj(cur)) { if (!Object.prototype.hasOwnProperty.call(cur, k)) return undefined; cur = cur[k] }
    else return undefined
  }
  return cur
}

// ── the check ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface VerifyBillMatchOptions {
  policy?: ApPolicy
  producer?: string
  now?: () => Date
  /** 'ap-structured' or 'ap-structured@0.1.0' (the only version). */
  ruleset?: string | { id: string; version: string }
  /** The engine version to re-perform under (2026-10-03, version.ts engineFor): this build's when absent, or an earlier one it retains. For replay. */
  engine?: string
}

export function resolveApStructuredRuleset(r?: string | { id: string; version: string }): ApStructuredRuleset {
  if (r === undefined) return AP_STRUCTURED_RULESET
  const [id, version] = typeof r === 'string' ? r.split('@') as [string, string | undefined] : [r.id, r.version]
  if (id === AP_STRUCTURED_RULESET.id && (version === undefined || version === AP_STRUCTURED_RULESET.version)) return AP_STRUCTURED_RULESET
  throw new Error(`unknown structured AP ruleset "${typeof r === 'string' ? r : `${r.id}@${r.version}`}"; known: ${AP_STRUCTURED_RULESET.id}@${AP_STRUCTURED_RULESET.version}`)
}

const SOURCE: Record<string, EvidenceSource> = { bill: 'invoice', purchase_order: 'contract', item_receipts: 'evidence', payment_history: 'history' }

/**
 * The three-way match on structured input. Throws ApInputInvalid (with typed, field-named errors) on an input that does not
 * validate, and Error on an unknown ruleset; otherwise returns the same ApResult the text path does.
 */
export function verifyBillMatch(input: unknown, options: VerifyBillMatchOptions = {}): ApResult {
  const ruleset = resolveApStructuredRuleset(options.ruleset)
  const checked = validateApInput(input)
  if (!checked.ok) throw new ApInputInvalid(checked.errors)
  const docs = apInputDocuments(checked.input)
  const { bill, purchase_order: po } = docs
  const engine_version = engineFor(options.engine)
  // Engine 0.6.0 (2026-10-05): the duplicate check reads vendor ids, tax ids and normalized names (./duplicate.ts),
  // and a run without payment history states the check that did not run as a claim. Earlier engines: unchanged.
  const v060 = engineAtLeast(engine_version, '0.6.0')
  // engine 0.7.0 (./v070.ts): a booked number similar to this bill's is said to be similar, as on the text path
  const v070 = v060 && readsAs070(engine_version)
  const pol = apPolicyOf(options.policy)
  const { price_tolerance: tolP, total_tolerance: tolT } = pol
  const freightByPolicy = apFreightByPolicy(pol, v060)
  // engine 0.6.0: tax on a purchase order that states no tax terms, by the run's tax policy
  const taxByPolicy = apTaxByPolicy(pol, v060)
  const billCur = currencyOf(bill.currency, [bill.amount, bill.freight, bill.tax, ...bill.line_items.flatMap((l) => [l.unit_price, l.amount])])
  const poCur = currencyOf(po.currency, po.line_items.flatMap((l) => [l.unit_price, l.amount]))
  const currencyMismatch = billCur !== null && poCur !== null && billCur !== poCur
  const lineCurrency = billCur ?? poCur
  const poNumber = po.purchase_order_number

  const ev = (pointer: string, r: Read | { value: string | number | boolean | null }, role: Evidence['role']): Evidence => {
    const source = SOURCE[pointer.split('/')[1] ?? ''] ?? 'evidence'
    const x = r as Read
    return { locator: { kind: 'field', source, path: pointer }, value: x.value, ...(x.original !== undefined ? { original: canonicalOriginal(x.original), normalizations: x.normalizations ?? [] } : {}), confidence: 100, role }
  }
  const claims: ClaimVerdict[] = []
  const insufficient = (claim_id: string, field: string, rule_id: string, rule_name: string, reason: NonNullable<ClaimVerdict['insufficiency']>['reason'], detail: string, missing?: string[]): ClaimVerdict =>
    ({ claim_id, kind: 'CROSS_REFERENCE', tier: 'DETERMINISTIC', outcome: 'INSUFFICIENT_DATA', field, asserted: null, rule_id, rule_name, evidence: [], insufficiency: { reason, detail, ...(missing ? { missing } : {}) }, locked: false, explanation: detail })

  // --- line matching: by PO line id, else by a SKU naming exactly one PO line, else can't-tell -----------------------------
  // (read before the duplicate check since 2026-10-06: the billed-to-date figures can settle a possible resubmission)
  const poIndex = new Map(po.line_items.map((l, j) => [l.id, j]))
  const unmatched = new Map<number, { detail: string; missing: string[] }>()
  const claimants = new Map<number, number[]>()
  bill.line_items.forEach((l, i) => {
    const n = i + 1
    if (l.purchase_order_line_item_id) {
      const j = poIndex.get(l.purchase_order_line_item_id)
      if (j === undefined) unmatched.set(i, { detail: `bill line ${n} names PO line "${l.purchase_order_line_item_id}", which is not on purchase order ${poNumber}`, missing: ['purchase_order_line_item_id'] })
      else claimants.set(j, [...(claimants.get(j) ?? []), i])
    } else if (l.sku) {
      const want = l.sku.trim().toUpperCase()
      const hits = po.line_items.flatMap((p, j) => (p.sku && p.sku.trim().toUpperCase() === want ? [j] : []))
      if (hits.length === 1) claimants.set(hits[0]!, [...(claimants.get(hits[0]!) ?? []), i])
      else unmatched.set(i, { detail: hits.length ? `bill line ${n}'s SKU ${l.sku} is on ${hits.length} PO lines` : `bill line ${n}'s SKU ${l.sku} is on no PO line`, missing: ['purchase_order_line_item_id'] })
    } else {
      unmatched.set(i, { detail: `bill line ${n} names no PO line (purchase_order_line_item_id) and no SKU`, missing: ['purchase_order_line_item_id'] })
    }
  })
  const byPo = new Map<number, number>()
  for (const [j, is] of claimants) {
    if (is.length === 1) { byPo.set(j, is[0]!); continue }
    for (const i of is) unmatched.set(i, { detail: `bill lines ${is.map((k) => k + 1).join(' and ')} all bill PO line ${j + 1} (${po.line_items[j]!.id}); the check reads one bill line per PO line`, missing: ['purchase_order_line_item_id'] })
  }

  // received quantity per PO line id, summed over every receipt
  const received = new Map<string, { total: number; refs: Evidence[] }>()
  docs.item_receipts.forEach((rc, r) => rc.line_items.forEach((l, k) => {
    const q = quantity(l.quantity)
    const cur = received.get(l.purchase_order_line_item_id) ?? { total: 0, refs: [] }
    cur.total += q.value
    cur.refs.push(ev(`/item_receipts/${r}/line_items/${k}/quantity`, q, 'REFERENCE'))
    received.set(l.purchase_order_line_item_id, cur)
  }))

  /**
   * 2026-10-06: the bill netted line by line against invoiced_quantity_to_date, for the duplicate check (duplicate.ts
   * DuplicateContext.netted): only when every bill line matches a PO line carrying the field, states a quantity and has a goods
   * receipt, earlier + this bill stays within what was received on every line, and at least one line records an earlier bill.
   */
  const netted = ((): NonNullable<Parameters<typeof duplicateClaimV060>[0]['netted']> | null => {
    if (!v060 || unmatched.size || !byPo.size) return null
    const lines: { name: string; L: number; earlier: number; this_bill: number; received: number }[] = []
    const evidence: Evidence[] = []
    for (const [j, i] of [...byPo].sort((a, b) => a[0] - b[0])) {
      const pl = po.line_items[j]!, bl = bill.line_items[i]!
      const rl = received.get(pl.id)
      if (!present(pl.invoiced_quantity_to_date) || !present(bl.quantity) || !rl) return null
      const earlier = quantity(pl.invoiced_quantity_to_date as ApQuantity), now = quantity(bl.quantity as ApQuantity)
      if (earlier.value + now.value > rl.total + 1e-9) return null
      lines.push({ name: pl.description ?? pl.sku ?? pl.id, L: j + 1, earlier: earlier.value, this_bill: now.value, received: rl.total })
      evidence.push(ev(`/purchase_order/line_items/${j}/invoiced_quantity_to_date`, earlier, 'REFERENCE'), ev(`/bill/line_items/${i}/quantity`, now, 'OPERAND'), ...rl.refs)
    }
    return lines.some((l) => l.earlier > 0) ? { lines, evidence } : null
  })()

  // --- claim: duplicate (only when payment history is supplied) ----------------------------------
  const not_checked: string[] = []
  const vendor = po.vendor?.name ?? bill.vendor.name ?? null
  const history: PriorInvoice[] | undefined = docs.payment_history ? docs.payment_history.map((h) => ({
    invoice_number: h.invoice_number,
    ...(h.purchase_order_number ? { po_number: h.purchase_order_number } : {}),
    ...(h.no_purchase_order === true ? { no_purchase_order: true } : {}),
    ...(present(h.amount) ? { total: money(h.amount as ApMoney, currencyOf(undefined, [h.amount])).value } : {}),
    ...(h.vendor ? { vendor: h.vendor } : {}),
    ...(h.paid_at ? { paid_on: h.paid_at } : {}),
  })) : undefined
  const billTotal = money(bill.amount, billCur)
  const invNo = bill.invoice_number
  if (!history) {
    not_checked.push('duplicate check: no payment history supplied (pass payment_history to enable it)')
    if (v060) claims.push(noHistoryClaim('pass payment_history to enable it'))
  } else if (v060) {
    const booked: BookedInvoice[] = docs.payment_history!.map((h, i) => ({
      ...history[i]!,
      ...(h.vendor_id ? { vendor_id: h.vendor_id } : {}),
      ...(h.vendor_tax_id ? { vendor_tax_id: h.vendor_tax_id } : {}),
    }))
    const given = (s: string | null | undefined): s is string => typeof s === 'string' && s.trim() !== ''
    const ids = [...new Set([bill.vendor.id, po.vendor?.id].filter(given).map((s) => s.trim()))]
    const taxIds = [...new Set([bill.vendor.tax_id, po.vendor?.tax_id].filter(given).map(normalizeTaxId))]
    // 2026-10-06: the bill's own vendor name, when it is not the purchase order's, so the words can call a look-alike one so
    const billName = given(bill.vendor.name) && vendor !== null && normalizeVendorName(bill.vendor.name) !== normalizeVendorName(vendor) ? bill.vendor.name.trim() : null
    claims.push(duplicateClaimV060({
      invoice_number: invNo, history: booked, vendor: { name: vendor, ids, tax_ids: taxIds, ...(billName ? { bill_name: billName } : {}) },
      po_number: bill.purchase_order_number ?? null, total: round2(billTotal.value), total_tolerance: tolT,
      ...(netted ? { netted } : {}),
      ...(v070 ? { similarNumbers: true } : {}),
      invoiceEvidence: ev('/bill/invoice_number', { value: invNo }, 'OPERAND'),
      historyEvidence: (i) => ({ locator: { kind: 'field', source: 'history', path: `/payment_history/${i}` }, value: booked[i]!.invoice_number, confidence: 100, role: 'REFERENCE' }),
      historyContext: { locator: { kind: 'field', source: 'history', path: '/payment_history' }, value: booked.length, confidence: 100, role: 'CONTEXT' },
    }))
  } else {
    const sameVendor = (h: PriorInvoice): boolean => !h.vendor || !vendor || h.vendor.trim().toLowerCase() === vendor.toLowerCase()
    const num = invNo.trim().toUpperCase()
    const exact = history.findIndex((h) => h.invoice_number.trim().toUpperCase() === num && sameVendor(h))
    const statedTotal = round2(billTotal.value)
    const invPo = bill.purchase_order_number ?? null
    const near = exact >= 0 ? -1 : history.findIndex((h) => sameVendor(h) && invPo !== null && h.po_number === invPo &&
      h.total !== undefined && close(round2(h.total), statedTotal, tolT))
    const histEv = (i: number): Evidence => ({ locator: { kind: 'field', source: 'history', path: `/payment_history/${i}` }, value: history[i]!.invoice_number, confidence: 100, role: 'REFERENCE' })
    if (exact >= 0) {
      const h = history[exact]!
      claims.push({ claim_id: 'ap.duplicate', kind: 'CROSS_REFERENCE', tier: 'DETERMINISTIC', outcome: 'FAIL', field: 'invoice_number', asserted: invNo,
        rule_id: 'AP_DUPLICATE', rule_name: 'Invoice not already booked',
        computation: { formula: 'invoice_number not in history (same vendor)', operands: { invoice_number: invNo, booked_as: h.invoice_number }, result: h.invoice_number },
        evidence: [ev('/bill/invoice_number', { value: invNo }, 'OPERAND'), histEv(exact)], locked: true,
        explanation: `Invoice ${invNo} is already in the books${h.paid_on ? ` (paid ${h.paid_on})` : ''}. Paying it again would be a duplicate payment.` })
    } else if (near >= 0) {
      const h = history[near]!
      claims.push({ ...insufficient('ap.duplicate', 'invoice_number', 'AP_DUPLICATE', 'Invoice not already booked', 'AMBIGUOUS_REFERENCE',
        `possible resubmission: same vendor, same PO (${h.po_number}) and same total (${h.total}) as booked invoice ${h.invoice_number}, under a different number — a person should confirm this is a new delivery`),
        evidence: [histEv(near)] })
    } else {
      claims.push({ claim_id: 'ap.duplicate', kind: 'CROSS_REFERENCE', tier: 'DETERMINISTIC', outcome: 'PASS', field: 'invoice_number', asserted: invNo,
        rule_id: 'AP_DUPLICATE', rule_name: 'Invoice not already booked',
        computation: { formula: 'invoice_number not in history (same vendor)', operands: { invoice_number: invNo, history_size: history.length }, result: null },
        evidence: [ev('/bill/invoice_number', { value: invNo }, 'OPERAND'), { locator: { kind: 'field', source: 'history', path: '/payment_history' }, value: history.length, confidence: 100, role: 'CONTEXT' }],
        locked: true, explanation: `Invoice ${invNo} does not appear among ${history.length} booked invoice(s).` })
    }
  }

  // --- claim: PO number -------------------------------------------------------------------------
  const billPo = bill.purchase_order_number?.trim() || null
  if (billPo === null) {
    claims.push({ claim_id: 'ap.po_number', kind: 'CROSS_REFERENCE', tier: 'DETERMINISTIC', outcome: 'FAIL', field: 'po_number', asserted: null, rule_id: 'AP_PO_MATCH', rule_name: 'Invoice references the purchase order',
      computation: { formula: 'invoice.po_number = po.number', operands: { invoice_po: null, po: poNumber }, result: poNumber },
      evidence: [ev('/purchase_order/purchase_order_number', { value: poNumber }, 'REFERENCE')], locked: true, explanation: `The bill cites no PO number; the open order is ${poNumber}.` })
  } else {
    const ok = billPo === poNumber.trim()
    claims.push({ claim_id: 'ap.po_number', kind: 'CROSS_REFERENCE', tier: 'DETERMINISTIC', outcome: ok ? 'PASS' : 'FAIL', field: 'po_number', asserted: billPo, rule_id: 'AP_PO_MATCH', rule_name: 'Invoice references the purchase order',
      computation: { formula: 'invoice.po_number = po.number', operands: { invoice_po: billPo, po: poNumber }, result: poNumber },
      evidence: [ev('/bill/purchase_order_number', { value: billPo }, 'OPERAND'), ev('/purchase_order/purchase_order_number', { value: poNumber }, 'REFERENCE')], locked: true,
      explanation: ok ? `The bill cites ${billPo}, which is the purchase order.` : `The bill cites ${billPo}; the open order is ${poNumber}.` })
  }

  // --- claim: vendor (engine 0.6.0; ./vendor.ts): the bill's vendor is the order's -------------------------
  let vendorRan = false
  let vendorClaim: ClaimVerdict | undefined
  if (v060) {
    const vc = vendorClaimStructured({ bill: bill.vendor, po: po.vendor,
      ev: (side, k, value) => ev(`/${side}/vendor/${k}`, { value }, side === 'bill' ? 'OPERAND' : 'REFERENCE') })
    if ('claim' in vc) { claims.push(vc.claim); vendorRan = true; vendorClaim = vc.claim } else not_checked.push(vc.notRun)
  }


  // --- claims: quantity + price + line amount, per billed PO line -----------------------------------------------------
  const digits = minorUnitDigits(lineCurrency)
  const lines: { prefix: string; name: string | null }[] = []
  /** the billed-to-date claims that ran (2026-10-06), in PO line order */
  const billedToDate: string[] = []
  const amountInsufficient = (prefix: string, field: string, reason: NonNullable<ClaimVerdict['insufficiency']>['reason'], detail: string, missing?: string[]): ClaimVerdict =>
    ({ ...insufficient(`${prefix}.amount`, field, AP_LINE_MATH_RULE.id, AP_LINE_MATH_RULE.name, reason, detail, missing), kind: 'RECOMPUTE' })
  po.line_items.forEach((pl, j) => {
    const L = j + 1
    const prefix = `ap.line[${L}]`
    const name = pl.description ?? pl.sku ?? pl.id
    const i = byPo.get(j)
    if (i === undefined) {
      // Not billed: nothing to check. Billed by several bill lines: those abstain below, under their own ids.
      if (!claimants.has(j)) not_checked.push(`PO line ${L} (${pl.id}) is not billed on this bill: nothing to check against it`)
      return
    }
    lines.push({ prefix, name })
    const bl = bill.line_items[i]!
    const bw = `/bill/line_items/${i}`
    const pw = `/purchase_order/line_items/${j}`
    const qty = present(bl.quantity) ? quantity(bl.quantity as ApQuantity) : null
    const unit = present(bl.unit_price) ? money(bl.unit_price as ApMoney, billCur) : null
    const amount = money(bl.amount, billCur)
    const poUnit = money(pl.unit_price, poCur)
    const lineRef = `(Bill line ${i + 1}${bl.description ? ` "${bl.description}"` : ''}.)`

    // quantity
    const rl = received.get(pl.id)
    if (!qty) claims.push(insufficient(`${prefix}.quantity`, `line[${L}].quantity`, 'AP_QTY_RECEIVED', 'Billed units were received', 'FIELD_MISSING', `bill line ${i + 1} states no quantity`, ['quantity']))
    else if (!rl) claims.push(insufficient(`${prefix}.quantity`, `line[${L}].quantity`, 'AP_QTY_RECEIVED', 'Billed units were received', 'REFERENCE_NOT_PROVIDED', `no goods-receipt line for PO line ${L}`))
    else {
      const ok = qty.value <= rl.total
      claims.push({ claim_id: `${prefix}.quantity`, kind: 'CROSS_REFERENCE', tier: 'DETERMINISTIC', outcome: ok ? 'PASS' : 'FAIL', field: `line[${L}].quantity`, asserted: qty.value,
        rule_id: 'AP_QTY_RECEIVED', rule_name: 'Billed units were received',
        computation: { formula: 'invoice.qty ≤ receipt.received', operands: { invoiced: qty.value, received: rl.total }, result: rl.total },
        evidence: [ev(`${bw}/quantity`, qty, 'OPERAND'), ...rl.refs], locked: true,
        ...(ok ? {} : { variance: qty.value - rl.total }),
        explanation: `${name}: billed ${qty.value}, received ${rl.total}${ok ? '' : ' — more billed than received'}. ${lineRef}` })
      // engine 0.6.0: the quantity already invoiced on this PO line, when the input carries it, netted
      if (v060 && present(pl.invoiced_quantity_to_date)) {
        const earlier = quantity(pl.invoiced_quantity_to_date as ApQuantity)
        const c = qtyToDateClaim({ prefix, L, name, earlier: earlier.value, this_bill: qty.value, received: rl.total,
          evidence: [ev(`${pw}/invoiced_quantity_to_date`, earlier, 'REFERENCE'), ev(`${bw}/quantity`, qty, 'OPERAND'), ...rl.refs] })
        claims.push(c)
        billedToDate.push(c.claim_id)
      }
    }

    // price
    const max = poUnit.value * (1 + tolP)
    if (!unit) claims.push(insufficient(`${prefix}.price`, `line[${L}].unit_price`, 'AP_PRICE_PO', 'Unit price within PO tolerance', 'FIELD_MISSING', `bill line ${i + 1} states no unit price`, ['unit_price']))
    else if (currencyMismatch) claims.push(insufficient(`${prefix}.price`, `line[${L}].unit_price`, 'AP_PRICE_PO', 'Unit price within PO tolerance', 'AMBIGUOUS_UNIT', `the bill is in ${billCur} and the purchase order in ${poCur}: unit prices are not compared across currencies`))
    else {
      const okP = unit.value <= max + 1e-9
      claims.push({ claim_id: `${prefix}.price`, kind: 'CROSS_REFERENCE', tier: 'DETERMINISTIC', outcome: okP ? 'PASS' : 'FAIL', field: `line[${L}].unit_price`, asserted: unit.value,
        rule_id: 'AP_PRICE_PO', rule_name: 'Unit price within PO tolerance',
        computation: { formula: `invoice.unit ≤ po.unit × ${1 + tolP}`, operands: { invoiced: unit.value, po_unit: poUnit.value }, result: round2(max * 10000) / 10000, tolerance: { rel: tolP } },
        evidence: [ev(`${bw}/unit_price`, unit, 'OPERAND'), ev(`${pw}/unit_price`, poUnit, 'REFERENCE')], locked: true,
        ...(okP ? {} : { variance: round2(unit.value - poUnit.value) }),
        // engine 0.6.0: the tolerance is a parameter (ap --price-tolerance), so the words name it
        explanation: `${name}: invoiced ${unit.value}, PO ${poUnit.value} (max ${max.toFixed(4)}${v060 ? ` at the ${Math.round(tolP * 1e6) / 1e4}% price tolerance` : ''})${okP ? '' : ' — over tolerance'}.` })
    }

    // line amount
    const m = recomputeLine({ quantity: qty?.value ?? null, unit_price: unit?.value ?? null, amount: amount.value, minor_digits: digits })
    if (!m.ok) { claims.push(amountInsufficient(prefix, `line[${L}].amount`, m.reason, `bill line ${i + 1}: ${m.detail}`, m.reason === 'FIELD_MISSING' ? [!qty ? 'quantity' : 'unit_price'] : undefined)); return }
    const adjustment = m.outcome === 'FAIL' ? adjustmentOf(bl, qty!.value, amount.value) : null
    if (adjustment) {
      claims.push(amountInsufficient(prefix, `line[${L}].amount`, 'AMBIGUOUS_FIELD', `${name}: ${qty!.value} × ${unit!.value} = ${m.recomputed_text} but the line says ${amount.value}, and the line carries an adjustment (${adjustment}) that quantity × unit price does not model; not guessing a FAIL`))
      return
    }
    const okA = m.outcome === 'PASS'
    claims.push({ claim_id: `${prefix}.amount`, kind: 'RECOMPUTE', tier: 'DETERMINISTIC', outcome: m.outcome, field: `line[${L}].amount`, asserted: amount.value,
      rule_id: AP_LINE_MATH_RULE.id, rule_name: AP_LINE_MATH_RULE.name,
      computation: { formula: AP_LINE_MATH_RULE.formula, operands: { quantity: qty!.value, unit_price: unit!.value, exact_product: m.exact_product, ...(lineCurrency ? { currency: lineCurrency } : {}), minor_unit_digits: digits }, result: m.recomputed, tolerance: { abs: m.tolerance } },
      evidence: [ev(`${bw}/amount`, amount, 'OPERAND'), ev(`${bw}/quantity`, qty!, 'OPERAND'), ev(`${bw}/unit_price`, unit!, 'OPERAND')],
      locked: true, ...(okA ? {} : { variance: m.variance }),
      explanation: okA
        ? `${name}: ${qty!.value} × ${unit!.value} = ${m.exact_product}; the line says ${amount.value}${m.deviation > 0 ? ` (within one minor unit, ${m.tolerance}: rounding)` : ''}.`
        : `${name}: ${qty!.value} × ${unit!.value} = ${m.recomputed_text}, but the line says ${amount.value} (${m.variance > 0 ? 'over' : 'under'} by ${m.variance_text.replace(/^-/, '')}).` })
  })

  // --- claims: bill lines that match no PO line (can't-tell; the remedy names the field to fill) ---------------------------
  for (const [i, u] of [...unmatched].sort((a, b) => a[0] - b[0])) {
    const n = i + 1
    const prefix = `ap.bill_line[${n}]`
    const field = `/bill/line_items/${i}/purchase_order_line_item_id`
    lines.push({ prefix, name: bill.line_items[i]!.description ?? bill.line_items[i]!.sku ?? null })
    claims.push(insufficient(`${prefix}.quantity`, field, 'AP_QTY_RECEIVED', 'Billed units were received', 'AMBIGUOUS_REFERENCE', u.detail, u.missing))
    claims.push(insufficient(`${prefix}.price`, field, 'AP_PRICE_PO', 'Unit price within PO tolerance', 'AMBIGUOUS_REFERENCE', u.detail, u.missing))
    claims.push(amountInsufficient(prefix, field, 'AMBIGUOUS_REFERENCE', u.detail, u.missing))
  }

  // --- claim: total -------------------------------------------------------------------------------
  const freight = present(bill.freight) ? money(bill.freight as ApMoney, billCur) : null
  const tax = present(bill.tax) ? money(bill.tax as ApMoney, billCur) : null
  // engine 0.6.0: freight on a PO that does not say is allowed when the run's freight policy says so
  const poSaysFreight = po.freight_allowed === undefined || po.freight_allowed === null ? null : po.freight_allowed
  const byPolicy = freightByPolicy && poSaysFreight === null && freight !== null
  const freightAllowed = poSaysFreight ?? (byPolicy ? true : null)
  if (freight && freightAllowed === null) {
    claims.push({ ...insufficient('ap.total', 'total', 'AP_TOTAL_SUM', 'Stated total equals the lines (+ allowed freight)', 'AMBIGUOUS_UNIT', 'freight billed but the PO does not say whether freight is allowed'), kind: 'RECOMPUTE' })
  } else {
    const amounts = bill.line_items.map((l) => money(l.amount, billCur))
    const f = freight && freightAllowed ? freight.value : 0
    const t = tax ? tax.value : 0
    const sum = round2(amounts.reduce((s, a) => s + a.value, 0) + f + t)
    const ok = close(round2(billTotal.value), sum, tolT)
    const evidence: Evidence[] = [ev('/bill/amount', billTotal, 'OPERAND'), ...amounts.map((a, i) => ev(`/bill/line_items/${i}/amount`, a, 'OPERAND'))]
    if (freight) evidence.push(ev('/bill/freight', freight, freightAllowed ? 'OPERAND' : 'CONTEXT'))
    if (tax) evidence.push(ev('/bill/tax', tax, 'OPERAND'))
    claims.push({ claim_id: 'ap.total', kind: 'RECOMPUTE', tier: 'DETERMINISTIC', outcome: ok ? 'PASS' : 'FAIL', field: 'total', asserted: billTotal.value,
      rule_id: 'AP_TOTAL_SUM', rule_name: 'Stated total equals the lines (+ allowed freight)',
      computation: { formula: tax ? 'total = Σ line.amount + (freight if PO allows) + tax' : 'total = Σ line.amount + (freight if PO allows)',
        operands: { lines: round2(sum - f - t), freight: f, freight_allowed: po.freight_allowed ?? null, ...(tax ? { tax: t } : {}), ...(byPolicy ? { freight_policy: 'allow' } : {}) }, result: sum, tolerance: { abs: tolT } },
      evidence, locked: true, ...(ok ? {} : { variance: round2(billTotal.value - sum) }),
      // engine 0.6.0: in a clerk's words, never one number twice (./words.ts totalWords)
      explanation: v060
        ? totalWords({ stated: billTotal.value, lines: round2(sum - f - t), sum, ok, freight: freight ? freight.value : null, freightAllowed, ...(byPolicy ? { freightBy: 'policy' as const } : {}), tax: tax ? t : null, digits })
        : `Stated total ${billTotal.value}; lines ${round2(sum - f - t)}${freight ? `, freight ${freight.value} ${po.freight_allowed ? 'allowed' : 'NOT allowed (excluded)'}` : ''}${tax ? `, tax ${t}` : ''} = ${sum}.${ok ? '' : ' Does not add up.'}` })
  }

  // --- claim: tax (engine 0.6.0; ./tax.ts): only when the bill carries tax ------------------------------
  const taxRan = v060 && tax !== null
  if (taxRan) {
    const taxableOf = (i: number): boolean => {
      const j = [...byPo].find(([, bi]) => bi === i)?.[0]
      return j === undefined || po.line_items[j]!.taxable !== false
    }
    claims.push(taxClaim({
      tax: tax!.value, rate: present(po.tax_rate) ? (po.tax_rate as number) : null,
      // 2026-10-06: the run's tax policy, read only when the purchase order states no tax terms
      ...(taxByPolicy !== null ? { policy: taxByPolicy } : {}),
      lines: bill.line_items.map((l, i) => ({ amount: money(l.amount, billCur).value, taxable: taxableOf(i) })),
      minor_digits: digits,
      taxEvidence: ev('/bill/tax', tax!, 'OPERAND'),
      rateEvidence: present(po.tax_rate) ? ev('/purchase_order/tax_rate', { value: po.tax_rate as number }, 'REFERENCE') : null,
      lineEvidence: bill.line_items.map((l, i) => ev(`/bill/line_items/${i}/amount`, money(l.amount, billCur), 'OPERAND')),
    }))
  }

  // --- claim: PO balance (engine 0.6.0; only with payment_history: ./po-balance.ts) ------------------------
  if (v060 && history) {
    const given = (s: string | null | undefined): s is string => typeof s === 'string' && s.trim() !== ''
    const rows = docs.payment_history!
    claims.push(poBalanceClaim({
      po_number: poNumber, invoice_number: invNo,
      order_lines: po.line_items.map((l, j) => present(l.quantity)
        ? { total: quantity(l.quantity as ApQuantity).value * money(l.unit_price, poCur).value }
        : present(l.amount) ? { total: money(l.amount as ApMoney, poCur).value } : { total: null, missing: `/purchase_order/line_items/${j}/quantity` }),
      order_currency: poCur,
      order_evidence: po.line_items.flatMap((l, j) => present(l.quantity)
        ? [ev(`/purchase_order/line_items/${j}/quantity`, quantity(l.quantity as ApQuantity), 'REFERENCE'), ev(`/purchase_order/line_items/${j}/unit_price`, money(l.unit_price, poCur), 'REFERENCE')]
        : present(l.amount) ? [ev(`/purchase_order/line_items/${j}/amount`, money(l.amount as ApMoney, poCur), 'REFERENCE')] : []),
      bill_amounts: bill.line_items.map((l) => money(l.amount, billCur).value),
      bill_currency: billCur,
      bill_evidence: bill.line_items.map((l, i) => ev(`/bill/line_items/${i}/amount`, money(l.amount, billCur), 'OPERAND')),
      history: rows.map((h, i) => ({ ...history[i]!, ...(h.vendor_id ? { vendor_id: h.vendor_id } : {}), ...(h.vendor_tax_id ? { vendor_tax_id: h.vendor_tax_id } : {}) })),
      historyCurrency: (i) => codeOf(rows[i]!.amount) ?? null,
      historyEvidence: (i) => ({ locator: { kind: 'field', source: 'history', path: `/payment_history/${i}` }, value: rows[i]!.invoice_number, confidence: 100, role: 'REFERENCE' }),
      historyPointer: (i, f) => `/payment_history/${i}/${f === 'po_number' ? 'purchase_order_number' : 'amount'}`,
      vendor: {
        name: vendor,
        ids: [...new Set([bill.vendor.id, po.vendor?.id].filter(given).map((s) => s.trim()))],
        tax_ids: [...new Set([bill.vendor.tax_id, po.vendor?.tax_id].filter(given).map(normalizeTaxId))],
      },
      minor_digits: digits,
      tolerance: tolT,
    }))
    // 2026-10-05: an earlier bill on this order is netted by amount only; the answer says so where it applies
    const gap = perLineGapNote(poNumber, bookedOnOrder({ po_number: poNumber, invoice_number: invNo,
      history: rows.map((h, i) => ({ ...history[i]!, ...(h.vendor_id ? { vendor_id: h.vendor_id } : {}), ...(h.vendor_tax_id ? { vendor_tax_id: h.vendor_tax_id } : {}) })),
      vendor: { name: vendor, ids: [...new Set([bill.vendor.id, po.vendor?.id].filter(given).map((s) => s.trim()))], tax_ids: [...new Set([bill.vendor.tax_id, po.vendor?.tax_id].filter(given).map(normalizeTaxId))] } }))
    // 2026-10-06: a billed PO line that carries invoiced_quantity_to_date was netted line by line, so the gap is named only
    // for the lines that carry none, and the words say which field closes it
    const billedLines = [...byPo.keys()].sort((a, b) => a - b)
    const netted = billedLines.filter((j) => present(po.line_items[j]!.invoiced_quantity_to_date))
    if (gap && netted.length < billedLines.length) {
      not_checked.push(netted.length
        ? `${gap}; PO line${netted.length === 1 ? '' : 's'} ${netted.map((j) => j + 1).join(', ')} carr${netted.length === 1 ? 'ies' : 'y'} invoiced_quantity_to_date and ${netted.length === 1 ? 'was' : 'were'} netted line by line`
        : `${gap}. invoiced_quantity_to_date on each PO line (the quantity earlier bills invoiced on it) lets this bill be netted line by line`)
    }
  } else if (v060) not_checked.push(`${PO_BALANCE_NOT_RUN} (pass payment_history to enable it)`)

  // --- verdict ------------------------------------------------------------------------------------
  const coverage: Coverage = { claims_total: claims.length, claims_checked: 0, claims_pass: 0, claims_fail: 0, claims_insufficient: 0 }
  for (const c of claims) { if (c.outcome === 'PASS') coverage.claims_pass++; else if (c.outcome === 'FAIL') coverage.claims_fail++; else coverage.claims_insufficient++ }
  coverage.claims_checked = coverage.claims_pass + coverage.claims_fail
  const outcome: Outcome = coverage.claims_fail > 0 ? 'FAIL' : coverage.claims_checked === 0 ? 'INSUFFICIENT_DATA' : 'PASS'
  // 2026-10-05: the resolved policy (a default one is exactly { price_tolerance, total_tolerance }, as before)
  const input_hash = hashOf({ ap_structured: docs, policy: pol })
  // Engine 0.2.0: the id also binds the remedy table (protocol/verdict-id.ts verdictIdentity); engine 0.6.0 answers from its own.
  const remedies = apRemediesFor(engine_version)
  const { verdict_id, remedy_table_hash } = verdictIdentity(input_hash, ruleset, engine_version, remedies)
  const verdict: Verdict = {
    schema_version: SCHEMA_VERSION, verdict_id, issued_at: (options.now ?? (() => new Date()))().toISOString(), engine_version,
    ruleset: { ...ruleset }, input_hash, ...(remedy_table_hash !== undefined ? { remedy_table_hash } : {}), replayable: true,
    document: { extraction_hash: sha256(canonicalize(docs.bill)), ...(options.producer !== undefined ? { producer: options.producer } : {}), line_items: bill.line_items.length },
    references: { contract: true, evidence: docs.item_receipts.length, history: history?.length ?? 0, source: false },
    outcome, aggregation: 'ANY_FAIL_FAILS', claims, coverage,
  }
  attachScope(attachRemedies(verdict, { declared: (rule) => remedies[rule], document: 'invoice' }))

  return apPolicyDecision({
    verdict, claims, coverage, history: Boolean(history), lineMath: true, not_checked, lines,
    // engine 0.6.0: the PO balance check is the last in order (./decide.ts), so a hold on any other check wins
    ...(v060 && history ? { poBalance: true } : {}),
    // engine 0.6.0: the vendor check (the PO names a vendor) and the tax check (the bill carries tax)
    ...(vendorRan ? { vendor: true } : {}),
    ...(taxRan ? { tax: true } : {}),
    // engine 0.6.0: the billed-to-date checks that ran, and what an approve did not check
    ...(billedToDate.length ? { billedToDate } : {}),
    ...(v060 ? { approveScope: [
      ...[structuredVendorNotChecked(vendorClaim)].filter((s): s is string => s !== null),
      BANK_NOT_CHECKED_STRUCTURED,
      ...[taxNotChecked({ tax: tax ? tax.value : null, rate: present(po.tax_rate) ? (po.tax_rate as number) : null, policy: taxByPolicy })].filter((s): s is string => s !== null),
    ] } : {}),
    invoice_number: invNo, po_number: billPo,
    approveReason: history ? 'all checks passed, including the duplicate check' : 'all five checks passed',
    ...(v060 && !history ? { openReason: `${NO_HISTORY_DETAIL} (pass payment_history to enable it)` } : {}),
    // engine 0.6.0: never approve past a check that could not run; every abstain is payable false (./decide.ts)
    ...(v060 ? { failClosed: true } : {}),
  })
}

/** A raw money value as evidence `original`: scalars as given, a minor-unit object as its canonical JSON. */
function canonicalOriginal(m: ApMoney): string | number {
  return typeof m === 'object' ? canonicalize(m) : m
}

/** An adjustment the line recompute does not model: a discount, or a signed (negative) amount. Null when there is none. */
function adjustmentOf(l: ApBillLine, qty: number, amount: number): string | null {
  const nonZero = (x: unknown): boolean => present(x) && Number(typeof x === 'object' ? (x as { amount: unknown }).amount : x) !== 0
  if (nonZero(l.discount_amount)) return 'discount_amount'
  if (nonZero(l.discount_rate)) return 'discount_rate'
  if (amount < 0 || qty < 0) return 'a negative amount'
  return null
}
