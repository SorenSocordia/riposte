/**
 * ERP export → structured AP input (riposte.ap-input/0.1.0), for the shadow pilot (2026-10-03).
 *
 * A mapper reads one closed month's export from a folder and gives, per bill, the structured input the gate checks, plus
 * what the buyer itself did with the bill (paid, held, or still open). It never guesses:
 *   - a key or column the mapper does not know is UNMAPPED, and the reading refuses until it is acknowledged
 *     (`ignore`: the pilot's --ignore-columns), so nothing in the buyer's file is silently dropped or silently used;
 *   - a required file or column that is absent is MISSING, and the reading refuses;
 *   - a bill that cannot be put together (no PO linked, the PO not in the export, values the schema refuses) is not gated,
 *     and the report counts it with its reason.
 *
 * Sources and what was verified (the field names, against each provider's own published schema file; known-fields.ts):
 *   ramp          Ramp Developer API JSON (Bill, ApiBillInventoryLineItem, ApiPurchaseOrderResource, ApiItemReceiptResource):
 *                 field names VERIFIED. Export shape: each file an array of resources or a page { data, page }.
 *   xero          Xero Accounting API JSON (Invoice of Type ACCPAY, PurchaseOrder): field names VERIFIED. Xero has no goods
 *                 receipt object: receipts come from item_receipts.csv in this package's own receipts format, or the
 *                 quantity check cannot run. How a company links a bill to its PO is NOT verified (the Reference field
 *                 by default; a mapping file can name another).
 *   qbo           QuickBooks Online API JSON (Bill, PurchaseOrder; a bill line's LinkedTxn names its PO line): field names
 *                 VERIFIED against Finance.xsd. No item-receipt entity: receipts as for Xero.
 *   netsuite-csv  NetSuite saved-search CSV: column names UNVERIFIED (no published spec was fetched).
 *   xero-csv      Xero CSV export: column names UNVERIFIED.
 *   qbo-csv       QuickBooks Online CSV export: column names UNVERIFIED.
 *   generic-csv   this package's own column names (each field's own name: invoice_number, po, quantity, …), for any system,
 *                 renamed by a mapping file; the construction ERP drafts (erp-mappings.ts) sit on it (2026-10-05).
 * A CSV source's columns can be renamed with a mapping file (mapping.json) once a buyer's real file is in hand.
 *
 * The buyer's own decision is read from the export's status fields; that reading is this package's interpretation of each
 * provider's documented values, and the report says which field it came from.
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { readPopulationCSV, validateApInput, type ApStructuredInput } from 'riposte-verify'
import { QBO_BASE_FIELDS_UNVERIFIED, QBO_ELEMENT_NAMES, RAMP_FIELDS, XERO_FIELDS } from './known-fields.js'

export type SourceId = 'ramp' | 'xero' | 'qbo' | 'netsuite-csv' | 'xero-csv' | 'qbo-csv' | 'generic-csv'
export const SOURCE_IDS: readonly SourceId[] = ['ramp', 'xero', 'qbo', 'netsuite-csv', 'xero-csv', 'qbo-csv', 'generic-csv']
export type CsvSourceId = 'netsuite-csv' | 'xero-csv' | 'qbo-csv' | 'generic-csv'
export type BuyerDecision = 'pay' | 'hold' | 'open'

/** One bill as read from the export. */
export interface MappedBill {
  /** the export's own record id (how the buyer finds the bill in its system) */
  ref: string
  invoice_number: string | null
  vendor: string | null
  issued_at: string | null
  currency: string | null
  /** the bill total in major units, for dollar figures (from the export; never put on a receipt) */
  amount: number | null
  /** what the buyer did: paid, held (or rejected), or still open; `from` names the field it was read from */
  buyer: { decision: BuyerDecision; from: string }
  /** the structured input the gate checks; absent when the bill could not be put together */
  input?: ApStructuredInput
  /** why it could not */
  problem?: string
}

export interface ExportFile { name: string; sha256: string; bytes: number; records: number }

export interface ExportReading {
  source: SourceId
  files: ExportFile[]
  /** keys or columns no mapper rule names and the caller did not acknowledge */
  unmapped: string[]
  /** keys or columns the caller acknowledged (ignored on purpose) */
  ignored: string[]
  /** required files or columns that are absent */
  missing: string[]
  /** every bill in the export (all months); the pilot selects its month */
  bills: MappedBill[]
  notes: string[]
}

export class ExportRefused extends Error {
  constructor(message: string) { super(message); this.name = 'ExportRefused' }
}

/** Per file at most this many bytes, and at most this many bills in an export. */
export const EXPORT_LIMITS = { maxFileBytes: 100 * 1024 * 1024, maxBills: 100_000 } as const

// ── reading files ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** Bytes → text: UTF-8 (a byte-order mark is accepted), or UTF-16 with a byte-order mark. Anything else is refused. */
export function decodeExportBytes(name: string, buf: Uint8Array): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2))
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2))
  const body = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? buf.subarray(3) : buf
  try { return new TextDecoder('utf-8', { fatal: true }).decode(body) } catch {
    throw new ExportRefused(`${name} is not UTF-8 (nor UTF-16 with a byte-order mark): export it as UTF-8. Nothing was guessed about its encoding.`)
  }
}

interface Loaded { name: string; text: string; file: ExportFile }
function load(dir: string, name: string): Loaded {
  const path = join(dir, name)
  const size = statSync(path).size
  if (size > EXPORT_LIMITS.maxFileBytes) throw new ExportRefused(`${name} is ${size} bytes, over the ${EXPORT_LIMITS.maxFileBytes}-byte cap per file`)
  const buf = readFileSync(path)
  return { name, text: decodeExportBytes(name, buf), file: { name, sha256: createHash('sha256').update(buf).digest('hex'), bytes: buf.length, records: 0 } }
}
const filesMatching = (dir: string, re: RegExp): string[] => (existsSync(dir) ? readdirSync(dir).filter((f) => re.test(f)).sort() : [])

const isObj = (x: unknown): x is Record<string, any> => x !== null && typeof x === 'object' && !Array.isArray(x)
const str = (x: unknown): string | null => (typeof x === 'string' && x.trim() !== '' ? x.trim() : typeof x === 'number' && Number.isFinite(x) ? String(x) : null)
const num = (x: unknown): number | null => {
  if (typeof x === 'number' && Number.isFinite(x)) return x
  if (typeof x !== 'string') return null
  const s = x.trim().replace(/,/g, '')
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null
}
/** A date as YYYY-MM-DD: ISO strings, and Xero's /Date(ms+zone)/ form. */
export function isoDate(x: unknown): string | null {
  const s = str(x)
  if (!s) return null
  const ms = /^\/Date\((-?\d+)([+-]\d{4})?\)\/$/.exec(s)
  if (ms) return new Date(Number(ms[1])).toISOString().slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s) // m/d/yyyy (US CSV exports)
  if (us) return `${us[3]}-${us[1]!.padStart(2, '0')}-${us[2]!.padStart(2, '0')}`
  return null
}

/** The records of a JSON export file: an array, or an envelope holding one (Ramp { data }, Xero { Invoices }, QBO { QueryResponse: { Bill } }). */
function jsonRecords(l: Loaded, envelopes: string[][]): { records: Record<string, any>[]; envelopeKeys: string[] } {
  let x: unknown
  try { x = JSON.parse(l.text) } catch (e) { throw new ExportRefused(`${l.name} is not JSON: ${(e as Error).message}`) }
  if (Array.isArray(x)) return { records: x.filter(isObj), envelopeKeys: [] }
  if (isObj(x)) {
    for (const path of envelopes) {
      let cur: any = x
      for (const k of path) cur = isObj(cur) ? cur[k] : undefined
      if (Array.isArray(cur)) return { records: cur.filter(isObj), envelopeKeys: Object.keys(x) }
    }
  }
  throw new ExportRefused(`${l.name}: expected an array of records or ${envelopes.map((p) => `{ ${p.join(': { ')}${' }'.repeat(p.length - 1)}: [...] }`).join(' or ')}`)
}

// ── the normalized shapes every mapper produces ─────────────────────────────────────────────────────────────────────────

type Money = number | string | { amount: number | string; currency_code?: string; minor_unit_conversion_rate?: number | null }
interface NLine { id?: string | null; po_line_id?: string | null; sku?: string | null; description?: string | null; quantity?: number | string | null; unit_price?: Money | null; amount: Money
  /** 2026-10-06 (CSV): the line's unit of measure, when the mapping names the column; and why the line cannot be read (a price unit that is not E, C or M) */
  unit?: string | null; problem?: string }
interface NBill { ref: string; invoice_number: string | null; vendor: { id?: string | null; name?: string | null }; po_key: string | null; currency: string | null; amount: Money | null; amount_major: number | null; tax?: Money | null; issued_at: string | null; lines: NLine[]; buyer: { decision: BuyerDecision; from: string }
  /** 2026-10-05 (freight rule): the bill's freight, when the export states it apart from the lines */
  freight?: Money | null }
interface NPOLine { id: string; sku?: string | null; external_id?: string | null; description?: string | null; quantity?: number | string | null; unit_price: Money; amount?: Money | null
  /** 2026-10-06: the quantity invoiced on this PO line before the month's bills (a CSV column, when mapped) */
  invoiced_before?: number | null
  /** 2026-10-06 (CSV): the PO line's unit of measure, and why it cannot be read, as on a bill line */
  unit?: string | null; problem?: string }
interface NPO { keys: string[]; id?: string | null; number: string; vendor?: { id?: string | null; name?: string | null }; currency?: string | null; lines: NPOLine[] }
interface NReceipt { id?: string | null; number?: string | null; po_key: string; received_at?: string | null; lines: { po_line_id?: string | null; sku?: string | null; quantity: number | string }[] }

const majorOf = (m: Money | null | undefined): number | null => {
  if (m === null || m === undefined) return null
  if (isObj(m)) { const a = num(m.amount); const r = typeof m.minor_unit_conversion_rate === 'number' ? m.minor_unit_conversion_rate : 100; return a === null ? null : a / r }
  return num(m)
}
const clean = <T extends Record<string, unknown>>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '')) as T

/**
 * Put each bill together with its PO, the PO's item receipts (received by the end of `month`, when given) and the payment
 * history the export itself shows (bills of the same export the buyer paid, issued before this one).
 */
function assemble(bills: NBill[], pos: NPO[], receipts: NReceipt[], monthEnd: string | null): MappedBill[] {
  const poBy = new Map<string, NPO>()
  for (const p of pos) for (const k of p.keys) if (!poBy.has(k)) poBy.set(k, p)
  const paid = bills.filter((b) => b.buyer.decision === 'pay' && b.invoice_number)
  /**
   * 2026-10-06: the quantity invoiced on each PO line before a bill, when the export states each line's quantity invoiced
   * before the month (invoiced_before): that figure, plus each earlier bill of the month that bills the line (issued earlier, or
   * the same day and an earlier ref; a bill the buyer held is left out). It becomes invoiced_quantity_to_date, which the check
   * nets this bill's quantity against, line by line. A PO line without the figure carries none (and the answer names the gap).
   */
  const monthStart = monthEnd ? `${monthEnd.slice(0, 7)}-01` : null
  const lineOf = (po: NPO, l: NLine): string | null => {
    if (l.po_line_id) return po.lines.some((pl) => pl.id === l.po_line_id) ? l.po_line_id : null
    if (!l.sku) return null
    const hits = po.lines.filter((pl) => pl.sku && pl.sku.trim().toUpperCase() === l.sku!.trim().toUpperCase())
    return hits.length === 1 ? hits[0]!.id : null
  }
  const invoicedBefore = (b: NBill, po: NPO): Map<string, number> => {
    const out = new Map<string, number>()
    for (const pl of po.lines) if (typeof pl.invoiced_before === 'number') out.set(pl.id, pl.invoiced_before)
    if (!out.size) return out
    for (const e of bills) {
      if (e === b || e.buyer.decision === 'hold' || !e.po_key || poBy.get(e.po_key) !== po || e.issued_at === null || b.issued_at === null) continue
      if (!(e.issued_at < b.issued_at || (e.issued_at === b.issued_at && e.ref < b.ref))) continue
      if (monthStart && e.issued_at < monthStart) continue
      for (const l of e.lines) {
        const id = lineOf(po, l)
        const q = num(l.quantity)
        if (id !== null && out.has(id) && q !== null) out.set(id, Math.round((out.get(id)! + q) * 1e6) / 1e6)
      }
    }
    return out
  }
  return bills.map((b) => {
    const base: MappedBill = { ref: b.ref, invoice_number: b.invoice_number, vendor: b.vendor.name ?? b.vendor.id ?? null, issued_at: b.issued_at, currency: b.currency, amount: b.amount_major, buyer: b.buyer }
    if (!b.po_key) return { ...base, problem: 'no purchase order linked to the bill' }
    const po = poBy.get(b.po_key)
    if (!po) return { ...base, problem: `purchase order ${b.po_key} is not in the export` }
    if (!b.lines.length) return { ...base, problem: 'the bill has no lines' }
    if (b.amount === null) return { ...base, problem: 'the bill has no total' }
    // 2026-10-06 (CSV): a price unit that is not E, C or M, on the bill line or the PO line it bills, and units of measure that
    // differ between the two, send the bill to a person, naming the unit: never converted by a guess
    for (const [k, l] of b.lines.entries()) {
      if (l.problem) return { ...base, problem: `bill line ${k + 1}: ${l.problem}` }
      const id = lineOf(po, l)
      const pl = id !== null ? po.lines.find((x) => x.id === id) : undefined
      if (pl?.problem) return { ...base, problem: `bill line ${k + 1} bills PO line ${pl.id}, and ${pl.problem}` }
      const um = (s: string | null | undefined): string | null => (s && s.trim() ? s.trim().toUpperCase().replace(/\./g, '') : null)
      if (pl && um(l.unit) && um(pl.unit) && um(l.unit) !== um(pl.unit)) return { ...base, problem: `bill line ${k + 1} is in ${l.unit!.trim()} and the PO line it bills (${pl.id}) is in ${pl.unit!.trim()}: units of measure differ, not converted; a person reads the line` }
    }
    const skuLine = (sku: string | null | undefined): string | null => {
      if (!sku) return null
      const hits = po.lines.filter((l) => l.sku && l.sku.trim().toUpperCase() === sku.trim().toUpperCase())
      return hits.length === 1 ? hits[0]!.id : null
    }
    const recs = receipts.filter((r) => po.keys.includes(r.po_key) && (!monthEnd || !r.received_at || r.received_at <= monthEnd))
      .map((r) => ({ r, lines: r.lines.map((l) => ({ po_line_id: l.po_line_id ?? (l.sku && po.lines.some((pl) => pl.id === l.sku) ? l.sku : skuLine(l.sku)), quantity: l.quantity })).filter((l) => l.po_line_id) }))
      .filter((x) => x.lines.length > 0)
    const history = paid.filter((p) => p !== b && p.issued_at !== null && b.issued_at !== null && (p.issued_at < b.issued_at || (p.issued_at === b.issued_at && p.ref < b.ref)))
      // purchase_order_number (2026-10-05, engine 0.6.0's PO balance check): the order a paid bill was booked against, so the check
      // can net what earlier bills already charged to this bill's order. A paid bill with no PO link in the export carries none, and the
      // check says it was booked without one (no_purchase_order), so it is not counted against any order. A paid bill whose PO is
      // not in the export carries neither, and the check counts it as possibly on this order (verify docs/AP-INPUT.md)
      .map((p) => clean({ invoice_number: p.invoice_number!, vendor: p.vendor.name ?? undefined,
        purchase_order_number: p.po_key ? poBy.get(p.po_key)?.number ?? undefined : undefined, no_purchase_order: p.po_key ? undefined : true,
        amount: p.amount_major ?? undefined, paid_at: p.issued_at ?? undefined }))
    const before = invoicedBefore(b, po)
    const input = {
      schema: 'riposte.ap-input/0.1.0',
      bill: clean({
        id: b.ref, invoice_number: b.invoice_number ?? '', vendor: clean({ id: b.vendor.id ?? undefined, name: b.vendor.name ?? undefined }),
        purchase_order_number: po.number, currency: b.currency ?? undefined, amount: b.amount, freight: b.freight ?? undefined, tax: b.tax ?? undefined, issued_at: b.issued_at ?? undefined,
        line_items: b.lines.map((l) => clean({ id: l.id ?? undefined, purchase_order_line_item_id: l.po_line_id ?? undefined, sku: l.sku ?? undefined, description: l.description ?? undefined, quantity: l.quantity ?? undefined, unit_price: l.unit_price ?? undefined, amount: l.amount })),
      }),
      purchase_order: clean({
        id: po.id ?? undefined, purchase_order_number: po.number, vendor: po.vendor ? clean({ id: po.vendor.id ?? undefined, name: po.vendor.name ?? undefined }) : undefined, currency: po.currency ?? undefined,
        line_items: po.lines.map((l) => clean({ id: l.id, sku: l.sku ?? undefined, external_id: l.external_id ?? undefined, description: l.description ?? undefined, quantity: l.quantity ?? undefined, unit_price: l.unit_price, amount: l.amount ?? undefined,
          // 2026-10-06: only when the export states the line's quantity invoiced before the month
          invoiced_quantity_to_date: before.get(l.id) })),
      }),
      item_receipts: recs.map(({ r, lines }) => clean({ id: r.id ?? undefined, item_receipt_number: r.number ?? undefined, purchase_order_id: po.id ?? undefined, received_at: r.received_at ?? undefined, line_items: lines.map((l) => ({ purchase_order_line_item_id: l.po_line_id!, quantity: l.quantity })) })),
      // The duplicate check's scope in the pilot is this export: the bills of it paid before this one. For the month's first
      // bills that is genuinely none, so the history is given even when empty (2026-10-05): verify treats an ABSENT history as
      // "the duplicate check did not run" and sends the bill to a person, which would stop every first bill of a real month.
      // The report states the scope ("duplicates outside this export: only bills of this export paid earlier are compared").
      payment_history: history,
    }
    const v = validateApInput(input)
    if (!v.ok) return { ...base, problem: `the export's values do not make a valid AP input (${v.errors.length} error${v.errors.length === 1 ? '' : 's'}; first: ${v.errors[0]!.field || '/'} ${v.errors[0]!.message})` }
    return { ...base, input: v.input }
  })
}

// ── unmapped keys (JSON sources) ────────────────────────────────────────────────────────────────────────────────────────

function unknownKeys(where: string, obj: unknown, known: ReadonlySet<string>, out: Set<string>): void {
  if (!isObj(obj)) return
  for (const k of Object.keys(obj)) if (!known.has(k)) out.add(`${where}.${k}`)
}

// ── Ramp (JSON, field names verified) ───────────────────────────────────────────────────────────────────────────────────

const RAMP = Object.fromEntries(Object.entries(RAMP_FIELDS).map(([k, v]) => [k, new Set(v)])) as Record<string, Set<string>>
/** Ramp's bill status, read as the buyer's decision (interpretation of Ramp's documented enum values). */
function rampBuyer(b: Record<string, any>): { decision: BuyerDecision; from: string } {
  if (b.status === 'PAID' || b.status_summary === 'PAYMENT_COMPLETED') return { decision: 'pay', from: b.status === 'PAID' ? 'status PAID' : 'status_summary PAYMENT_COMPLETED' }
  if (['ON_HOLD', 'APPROVAL_REJECTED', 'BLOCKED'].includes(b.status_summary)) return { decision: 'hold', from: `status_summary ${b.status_summary}` }
  if (b.approval_status === 'REJECTED') return { decision: 'hold', from: 'approval_status REJECTED' }
  return { decision: 'open', from: `status ${b.status ?? '?'} / status_summary ${b.status_summary ?? '?'}` }
}
const rampMoney = (x: unknown): Money | null => (isObj(x) && (typeof x.amount === 'number' || typeof x.amount === 'string') ? clean({ amount: x.amount, currency_code: x.currency_code, minor_unit_conversion_rate: x.minor_unit_conversion_rate }) as Money : null)

/**
 * An expense line's memo that IS a freight charge's name (2026-10-05): the whole memo, its case, spacing and end
 * punctuation aside, is one of "freight", "shipping", "carriage" or "delivery", optionally "inbound"/"outbound" before it and
 * "and handling", "charge(s)", "cost(s)" or "fee" after it ("Freight", "Shipping & handling", "Delivery charge"). A memo that
 * only mentions one of them ("Shipping container rental") is not freight: under a run that froze "allow" it would be paid
 * as an allowed charge, so the name must be the whole memo.
 */
const FREIGHT_MEMO = /^(?:inbound |outbound )?(?:freight|shipping|carriage|delivery)(?: (?:and|&) handling)?(?: charges?| costs?| fees?)?$/
const isFreightMemo = (memo: string | null | undefined): boolean => FREIGHT_MEMO.test((memo ?? '').toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.:;,]+$/, ''))
/**
 * An expense line's memo that IS a tax's name (2026-10-06, the tax rule): the whole memo, its case, spacing and end
 * punctuation aside, is "tax" or "taxes", optionally "sales", "sales and use", "use", "state", "county", "city" or "local" before
 * it, or one of "VAT", "GST", "HST", "PST", "QST" ("Sales tax", "Sales & use tax", "VAT"). A memo that only mentions tax ("Tax
 * preparation services") is not, for the same reason as freight: under a run that froze "allow" it would be accepted as tax.
 */
const TAX_MEMO = /^(?:(?:sales(?: (?:and|&) use)?|use|state|county|city|local) )?tax(?:es)?$|^(?:vat|gst|hst|pst|qst)$/
const isTaxMemo = (memo: string | null | undefined): boolean => TAX_MEMO.test((memo ?? '').toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.:;,]+$/, ''))

function readRamp(dir: string, ignore: ReadonlySet<string>, monthEnd: string | null): Omit<ExportReading, 'source'> {
  const notes: string[] = []
  let freightBills = 0, taxBills = 0
  const pick = (re: RegExp, label: string, required: boolean): Loaded[] => {
    const names = filesMatching(dir, re)
    if (!names.length && required) throw new ExportRefused(`no ${label} file in ${dir} (expected ${re.source.replace(/\\/g, '')})`)
    return names.map((n) => load(dir, n))
  }
  const billFiles = pick(/^bills(\..+)?\.json$/, 'bills', true), poFiles = pick(/^purchase_orders(\..+)?\.json$/, 'purchase orders', true), recFiles = pick(/^item_receipts(\..+)?\.json$/, 'item receipts', false)
  if (!recFiles.length) notes.push('no item_receipts*.json: no PO line has a received quantity, so every quantity check will fail or abstain')
  const unk = new Set<string>()
  const recordsOf = (files: Loaded[]) => files.flatMap((l) => { const { records, envelopeKeys } = jsonRecords(l, [['data']]); l.file.records = records.length; for (const k of envelopeKeys) if (k !== 'data' && k !== 'page') unk.add(`${l.name}: (envelope).${k}`); return records })
  const rawBills = recordsOf(billFiles), rawPos = recordsOf(poFiles), rawRecs = recordsOf(recFiles)
  for (const b of rawBills) {
    unknownKeys('bills[]', b, RAMP.Bill!, unk)
    unknownKeys('bills[].vendor', b.vendor, RAMP.ApiBillVendor!, unk)
    for (const l of b.inventory_line_items ?? []) { unknownKeys('bills[].inventory_line_items[]', l, RAMP.ApiBillInventoryLineItem!, unk); unknownKeys('bills[].inventory_line_items[].amount', l.amount, RAMP.CurrencyAmount!, unk); unknownKeys('bills[].inventory_line_items[].unit_price', l.unit_price, RAMP.CurrencyAmount!, unk) }
    for (const l of b.line_items ?? []) unknownKeys('bills[].line_items[]', l, RAMP.ApiBillLineItem!, unk)
    unknownKeys('bills[].amount', b.amount, RAMP.CurrencyAmount!, unk)
  }
  for (const p of rawPos) { unknownKeys('purchase_orders[]', p, RAMP.ApiPurchaseOrderResource!, unk); for (const l of p.line_items ?? []) unknownKeys('purchase_orders[].line_items[]', l, RAMP.ApiPurchaseOrderLineItem!, unk) }
  for (const r of rawRecs) { unknownKeys('item_receipts[]', r, RAMP.ApiItemReceiptResource!, unk); for (const l of r.line_items ?? []) unknownKeys('item_receipts[].line_items[]', l, RAMP.ApiItemReceiptLineItem!, unk) }
  const pos: NPO[] = rawPos.map((p) => ({
    keys: [str(p.id), str(p.purchase_order_number)].filter((x): x is string => !!x), id: str(p.id), number: str(p.purchase_order_number) ?? str(p.id) ?? '',
    vendor: { id: str(p.vendor_id) }, currency: isObj(p.amount) ? str(p.amount.currency_code) : null,
    lines: (Array.isArray(p.line_items) ? p.line_items : []).filter(isObj).map((l: any) => ({ id: str(l.id) ?? '', external_id: str(l.external_id), description: str(l.description), quantity: num(l.quantity), unit_price: rampMoney(l.unit_price) as Money, amount: rampMoney(l.amount) })),
  }))
  const receipts: NReceipt[] = rawRecs.map((r) => ({ id: str(r.id), number: str(r.item_receipt_number), po_key: str(r.purchase_order_id) ?? '', received_at: isoDate(r.received_at), lines: (Array.isArray(r.line_items) ? r.line_items : []).filter(isObj).map((l: any) => ({ po_line_id: str(l.purchase_order_line_item_id), quantity: num(l.quantity) ?? 0 })) }))
  const bills: NBill[] = rawBills.map((b) => {
    const inv = (Array.isArray(b.inventory_line_items) ? b.inventory_line_items : []).filter(isObj)
    const exp = (Array.isArray(b.line_items) ? b.line_items : []).filter(isObj)
    // Inventory lines and expense lines both (2026-10-05). Before, a bill with inventory lines had its expense
    // lines (Ramp's tax, freight or any other charge without a PO line) dropped, so its total no longer added up and the reason
    // given was the wrong one. Now every line is read: an expense line with no PO line is a bill line the PO does not carry,
    // and the check says it cannot match it, naming the line. Nothing in the bill is silently left out.
    const lines: NLine[] = [
      ...inv.map((l: any) => ({ id: str(l.id), po_line_id: str(l.purchase_order_line_item_id), description: str(l.memo), quantity: num(l.quantity), unit_price: rampMoney(l.unit_price), amount: rampMoney(l.amount) as Money })),
      ...exp.map((l: any) => ({ id: str(l.id), po_line_id: str(l.purchase_order_line_item_id), description: str(l.memo), amount: rampMoney(l.amount) as Money })),
    ]
    // The freight rule (2026-10-05): Ramp's Bill has no freight field, so freight arrives as an expense line with no
    // PO line. Exactly one such line whose whole memo is a freight charge's name (isFreightMemo: "Freight", "Shipping & handling",
    // "Delivery charge"; never a memo that only mentions one) is read as the bill's freight, so the purchase order's
    // freight_allowed, or the run's frozen freight rule, decides it. Several such lines stay lines (which one is the freight is
    // not guessed), and the check names each.
    const freightAt = lines.flatMap((l, i) => (i >= inv.length && !l.po_line_id && isFreightMemo(l.description) ? [i] : []))
    const freight = freightAt.length === 1 ? lines[freightAt[0]!]!.amount : null
    if (freight !== null) { lines.splice(freightAt[0]!, 1); freightBills++ }
    // The tax rule (2026-10-06): Ramp's Bill has no tax field either. Exactly one expense line with no PO line whose
    // whole memo is a tax's name (isTaxMemo) is read as the bill's tax, so the purchase order's tax terms, or the run's frozen tax
    // rule, decide it. Several stay lines, as freight's do.
    const taxAt = lines.flatMap((l, i) => (i >= inv.length && !l.po_line_id && isTaxMemo(l.description) ? [i] : []))
    const tax = taxAt.length === 1 ? lines[taxAt[0]!]!.amount : null
    if (tax !== null) { lines.splice(taxAt[0]!, 1); taxBills++ }
    const amount = rampMoney(b.amount)
    return { ref: str(b.id) ?? str(b.invoice_number) ?? '?', invoice_number: str(b.invoice_number), vendor: { id: isObj(b.vendor) ? str(b.vendor.id) : null, name: isObj(b.vendor) ? str(b.vendor.name) : null }, po_key: str(b.purchase_order_id), currency: isObj(b.amount) ? str(b.amount.currency_code) : null, amount, amount_major: majorOf(amount), issued_at: isoDate(b.issued_at), lines, buyer: rampBuyer(b), ...(freight !== null ? { freight } : {}), ...(tax !== null ? { tax } : {}) }
  })
  if (taxBills) notes.push(`tax: ${taxBills} bill(s) carry one expense line with no PO line whose whole memo is a tax's name (such as "Sales tax", "Sales & use tax" or "VAT"); it is read as the bill's tax, which the purchase order's tax terms, or the run's frozen tax rule, decide`)
  if (freightBills) notes.push(`freight: ${freightBills} bill(s) carry one expense line with no PO line whose whole memo is a freight charge's name (such as "Freight", "Shipping & handling" or "Delivery charge"); it is read as the bill's freight, which the purchase order's freight_allowed, or the run's frozen freight rule, allows or not`)
  return finish([...billFiles, ...poFiles, ...recFiles], unk, ignore, [], assemble(bills, pos, receipts, monthEnd), notes)
}

// ── Xero and QuickBooks Online (API JSON, field names verified) + this package's receipts CSV ───────────────────────────

/** item_receipts.csv, this package's own format, for sources without a goods-receipt object: one row per received line. */
export const RECEIPTS_CSV_COLUMNS = ['receipt_id', 'purchase_order_number', 'line_ref', 'quantity', 'received_at'] as const
function readReceiptsCsv(dir: string, files: Loaded[], unk: Set<string>, missing: string[]): NReceipt[] {
  if (!existsSync(join(dir, 'item_receipts.csv'))) return []
  const l = load(dir, 'item_receipts.csv')
  files.push(l)
  const pop = readPopulationCSV(l.text)
  const columns = pop.columns ?? []
  l.file.records = pop.rows.length
  for (const c of columns) if (!(RECEIPTS_CSV_COLUMNS as readonly string[]).includes(c)) unk.add(`item_receipts.csv: column "${c}"`)
  for (const c of ['purchase_order_number', 'line_ref', 'quantity']) if (!columns.includes(c)) missing.push(`item_receipts.csv: column "${c}"`)
  const by = new Map<string, NReceipt>()
  for (const row of pop.rows) {
    const v = row.values as Record<string, string>
    const po = str(v.purchase_order_number)
    if (!po) continue
    const key = `${v.receipt_id ?? ''}|${po}`
    let r = by.get(key)
    if (!r) { r = { id: str(v.receipt_id), po_key: po, received_at: isoDate(v.received_at), lines: [] }; by.set(key, r) }
    r.lines.push({ po_line_id: null, sku: str(v.line_ref), quantity: num(v.quantity) ?? str(v.quantity) ?? 0 })
  }
  return [...by.values()]
}

function readXero(dir: string, ignore: ReadonlySet<string>, monthEnd: string | null, poField: string): Omit<ExportReading, 'source'> {
  const files: Loaded[] = []
  const need = (n: string): Loaded => { if (!existsSync(join(dir, n))) throw new ExportRefused(`no ${n} in ${dir} (the Xero API's { "${n.replace('.json', '')}": [...] })`); const l = load(dir, n); files.push(l); return l }
  const inv = need('Invoices.json'), po = need('PurchaseOrders.json')
  const unk = new Set<string>(), missing: string[] = [], notes: string[] = []
  const K = (n: string) => new Set(XERO_FIELDS[n] ?? [])
  const env = new Set(['Id', 'Status', 'ProviderName', 'DateTimeUTC', 'Invoices', 'PurchaseOrders', 'pagination', 'Warnings'])
  const recs = (l: Loaded, key: string) => { const { records, envelopeKeys } = jsonRecords(l, [[key]]); l.file.records = records.length; for (const k of envelopeKeys) if (!env.has(k)) unk.add(`${l.name}: (envelope).${k}`); return records }
  const rawInv = recs(inv, 'Invoices').filter((x) => x.Type === undefined || x.Type === 'ACCPAY')
  const rawPo = recs(po, 'PurchaseOrders')
  for (const x of rawInv) { unknownKeys('Invoices[]', x, K('Invoice'), unk); unknownKeys('Invoices[].Contact', x.Contact, K('Contact'), unk); for (const l of x.LineItems ?? []) unknownKeys('Invoices[].LineItems[]', l, K('LineItem'), unk) }
  for (const x of rawPo) { unknownKeys('PurchaseOrders[]', x, K('PurchaseOrder'), unk); for (const l of x.LineItems ?? []) unknownKeys('PurchaseOrders[].LineItems[]', l, K('LineItem'), unk) }
  const receipts = readReceiptsCsv(dir, files, unk, missing)
  if (!receipts.length) notes.push('Xero has no goods-receipt object and no item_receipts.csv was given: every quantity check will abstain or fail')
  notes.push(`a bill's PO is read from Invoice.${poField} (how a company links a bill to its PO in Xero is not verified)`)
  const pos: NPO[] = rawPo.map((p) => ({ keys: [str(p.PurchaseOrderNumber), str(p.PurchaseOrderID)].filter((x): x is string => !!x), id: str(p.PurchaseOrderID), number: str(p.PurchaseOrderNumber) ?? '', vendor: { id: isObj(p.Contact) ? str(p.Contact.ContactID) : null, name: isObj(p.Contact) ? str(p.Contact.Name) : null }, currency: str(p.CurrencyCode),
    lines: (p.LineItems ?? []).filter(isObj).map((l: any, i: number) => ({ id: str(l.ItemCode) ?? str(l.LineItemID) ?? `line-${i + 1}`, sku: str(l.ItemCode), description: str(l.Description), quantity: num(l.Quantity), unit_price: num(l.UnitAmount) ?? 0, amount: num(l.LineAmount) })) }))
  const xeroBuyer = (x: Record<string, any>): { decision: BuyerDecision; from: string } => x.Status === 'PAID' ? { decision: 'pay', from: 'Status PAID' } : x.Status === 'VOIDED' || x.Status === 'DELETED' ? { decision: 'hold', from: `Status ${x.Status}` } : { decision: 'open', from: `Status ${x.Status ?? '?'}` }
  const bills: NBill[] = rawInv.map((x) => ({ ref: str(x.InvoiceID) ?? str(x.InvoiceNumber) ?? '?', invoice_number: str(x.InvoiceNumber), vendor: { id: isObj(x.Contact) ? str(x.Contact.ContactID) : null, name: isObj(x.Contact) ? str(x.Contact.Name) : null }, po_key: str(x[poField]), currency: str(x.CurrencyCode), amount: num(x.Total), amount_major: num(x.Total), tax: num(x.TotalTax), issued_at: isoDate(x.Date),
    lines: (x.LineItems ?? []).filter(isObj).map((l: any) => ({ id: str(l.LineItemID), sku: str(l.ItemCode), description: str(l.Description), quantity: num(l.Quantity), unit_price: num(l.UnitAmount), amount: num(l.LineAmount) ?? 0 })), buyer: xeroBuyer(x) }))
  return finish(files, unk, ignore, missing, assemble(bills, pos, receipts, monthEnd), notes)
}

function readQbo(dir: string, ignore: ReadonlySet<string>, monthEnd: string | null): Omit<ExportReading, 'source'> {
  const files: Loaded[] = []
  const need = (n: string): Loaded => { if (!existsSync(join(dir, n))) throw new ExportRefused(`no ${n} in ${dir} (a QuickBooks Online query response, or an array)`); const l = load(dir, n); files.push(l); return l }
  const billF = need('Bill.json'), poF = need('PurchaseOrder.json')
  const unk = new Set<string>(), missing: string[] = [], notes: string[] = []
  const known = new Set([...QBO_ELEMENT_NAMES, ...QBO_BASE_FIELDS_UNVERIFIED])
  const recs = (l: Loaded, key: string) => { const { records, envelopeKeys } = jsonRecords(l, [['QueryResponse', key], [key]]); l.file.records = records.length; for (const k of envelopeKeys) if (k !== 'QueryResponse' && k !== 'time' && k !== key) unk.add(`${l.name}: (envelope).${k}`); return records }
  const rawBills = recs(billF, 'Bill'), rawPos = recs(poF, 'PurchaseOrder')
  const walk = (where: string, x: unknown, depth = 0): void => { if (!isObj(x) || depth > 3) return; unknownKeys(where, x, known, unk); for (const [k, v] of Object.entries(x)) { if (Array.isArray(v)) v.forEach((e) => walk(`${where}.${k}[]`, e, depth + 1)); else if (isObj(v)) walk(`${where}.${k}`, v, depth + 1) } }
  for (const b of rawBills) walk('Bill[]', b)
  for (const p of rawPos) walk('PurchaseOrder[]', p)
  const receipts = readReceiptsCsv(dir, files, unk, missing)
  if (!receipts.length) notes.push('QuickBooks Online has no item-receipt entity and no item_receipts.csv was given: every quantity check will abstain or fail')
  const lineOf = (l: any) => ({ d: isObj(l.ItemBasedExpenseLineDetail) ? l.ItemBasedExpenseLineDetail : {} as any })
  const pos: NPO[] = rawPos.map((p) => ({ keys: [str(p.Id), str(p.DocNumber)].filter((x): x is string => !!x), id: str(p.Id), number: str(p.DocNumber) ?? str(p.Id) ?? '', vendor: isObj(p.VendorRef) ? { id: str(p.VendorRef.value), name: str(p.VendorRef.name) } : {}, currency: isObj(p.CurrencyRef) ? str(p.CurrencyRef.value) : null,
    lines: (p.Line ?? []).filter((l: any) => isObj(l) && l.DetailType === 'ItemBasedExpenseLineDetail').map((l: any) => { const { d } = lineOf(l); return { id: str(l.Id) ?? '', sku: isObj(d.ItemRef) ? str(d.ItemRef.value) : null, description: str(l.Description), quantity: num(d.Qty), unit_price: num(d.UnitPrice) ?? 0, amount: num(l.Amount) } }) }))
  const bills: NBill[] = rawBills.map((b) => {
    const poTxn = [...(b.LinkedTxn ?? []), ...(b.Line ?? []).flatMap((l: any) => l?.LinkedTxn ?? [])].find((t: any) => isObj(t) && t.TxnType === 'PurchaseOrder')
    const lines: NLine[] = (b.Line ?? []).filter((l: any) => isObj(l) && l.DetailType === 'ItemBasedExpenseLineDetail').map((l: any) => {
      const { d } = lineOf(l)
      const t = (l.LinkedTxn ?? []).find((x: any) => isObj(x) && x.TxnType === 'PurchaseOrder')
      return { id: str(l.Id), po_line_id: t ? str(t.TxnLineId) : null, sku: isObj(d.ItemRef) ? str(d.ItemRef.value) : null, description: str(l.Description), quantity: num(d.Qty), unit_price: num(d.UnitPrice), amount: num(l.Amount) ?? 0 }
    })
    const balance = num(b.Balance)
    const buyer: { decision: BuyerDecision; from: string } = balance === 0 ? { decision: 'pay', from: 'Balance 0' } : { decision: 'open', from: `Balance ${balance ?? '?'}` }
    return { ref: str(b.Id) ?? str(b.DocNumber) ?? '?', invoice_number: str(b.DocNumber), vendor: isObj(b.VendorRef) ? { id: str(b.VendorRef.value), name: str(b.VendorRef.name) } : {}, po_key: poTxn ? str(poTxn.TxnId) : null, currency: isObj(b.CurrencyRef) ? str(b.CurrencyRef.value) : null, amount: num(b.TotalAmt), amount_major: num(b.TotalAmt), issued_at: isoDate(b.TxnDate), lines, buyer }
  })
  notes.push('a QuickBooks bill is read as held only when a mapping says so: the Bill entity has no hold status (Balance 0 is read as paid)')
  return finish(files, unk, ignore, missing, assemble(bills, pos, receipts, monthEnd), notes)
}

// ── CSV sources (column names UNVERIFIED; a mapping file renames them) ──────────────────────────────────────────────────

/** Our names for what a CSV export holds, per file. */
export const CSV_TARGETS = {
  // price_per and unit (2026-10-06): optional, the unit the rate is per (E each, C per hundred, M per thousand) and the unit of measure
  bills: ['ref', 'invoice_number', 'vendor', 'date', 'currency', 'total', 'tax', 'po', 'status', 'line_id', 'item', 'description', 'quantity', 'rate', 'amount', 'price_per', 'unit'],
  // invoiced_quantity (2026-10-06): optional, the quantity invoiced on the PO line before the month's bills
  purchase_orders: ['ref', 'number', 'vendor', 'currency', 'line_id', 'item', 'description', 'quantity', 'rate', 'amount', 'invoiced_quantity', 'price_per', 'unit'],
  item_receipts: ['ref', 'number', 'po', 'date', 'item', 'quantity'],
} as const

/**
 * A price unit (2026-10-06): what one rate buys, as Vista's ECM column writes it (E each, C per hundred, M per thousand), or
 * 1, 100, 1000, or the words. The divisor that turns the rate into a price per unit, or null when the value is none of these.
 */
export function pricePerDivisor(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(/^per\s+/, '').replace(/^\//, '')
  if (['e', 'ea', 'each', '1'].includes(s)) return 1
  if (['c', 'hundred', '100'].includes(s)) return 100
  if (['m', 'thousand', '1000', '1,000'].includes(s)) return 1000
  return null
}
/**
 * A CSV line's rate as a price per unit (2026-10-06): divided by its price unit when the mapping reads one. A blank price unit
 * reads as each, unless the line's own amount says the rate is per hundred or per thousand (then a person reads it). A value
 * that is not E, C or M is a problem, naming the unit and the column.
 */
function perUnit(x: { rate: number | null; quantity: number | null; amount: number | null; raw: string | null; column: string; where: string }): { rate: number | null } | { problem: string } {
  if (x.raw === null || x.raw.trim() === '') {
    if (x.rate !== null && x.quantity !== null && x.amount !== null && Math.abs(x.quantity * x.rate - x.amount) > 0.011) {
      for (const d of [100, 1000]) if (Math.abs((x.quantity * x.rate) / d - x.amount) <= 0.011) return { problem: `${x.where} states no price unit (column ${x.column} is blank), and its amount is quantity × rate / ${d}: priced per ${d === 100 ? 'hundred' : 'thousand'}? Not converted, never guessed; a person reads the line` }
    }
    return { rate: x.rate }
  }
  const d = pricePerDivisor(x.raw)
  if (d === null) return { problem: `${x.where} prices per "${x.raw.trim()}" (column ${x.column}), which is not E (each), C (per hundred) or M (per thousand): not converted, never guessed; a person reads the line` }
  return { rate: x.rate === null ? null : Math.round((x.rate / d) * 1e9) / 1e9 }
}
export type CsvFileKind = keyof typeof CSV_TARGETS

export interface CsvPreset {
  /** file name per kind */
  files: Record<CsvFileKind, string>
  /** our target → the export's column name */
  columns: { [K in CsvFileKind]: Partial<Record<(typeof CSV_TARGETS)[K][number], string>> }
  /** targets that must be present */
  required: { [K in CsvFileKind]: string[] }
  /** columns known to appear and deliberately not read */
  ignore?: string[]
  /** status value → the buyer's decision (case-insensitive); anything else is open */
  status: { pay: string[]; hold: string[] }
  /** a prefix the PO reference carries (NetSuite's "Purchase Order #") */
  poPrefix?: string
  unverified: string
  /** 2026-10-06: what a mapping file says a buyer must know before trusting it (a drafted ERP mapping's notes), printed with the reading */
  notes?: string[]
}

/** Each target named by itself: the generic-csv preset's columns. */
const selfNamed = <K extends CsvFileKind>(kind: K) => Object.fromEntries(CSV_TARGETS[kind].map((t) => [t, t])) as CsvPreset['columns'][K]

export const CSV_PRESETS: Record<CsvSourceId, CsvPreset> = {
  'generic-csv': {
    files: { bills: 'bills.csv', purchase_orders: 'purchase_orders.csv', item_receipts: 'item_receipts.csv' },
    columns: { bills: selfNamed('bills'), purchase_orders: selfNamed('purchase_orders'), item_receipts: selfNamed('item_receipts') },
    required: { bills: ['invoice_number', 'date', 'total', 'po', 'item', 'quantity', 'rate', 'amount'], purchase_orders: ['number', 'item', 'rate'], item_receipts: ['po', 'item', 'quantity'] },
    status: { pay: ['paid'], hold: ['held'] },
    unverified: 'generic-csv: the columns are this package\'s own field names, or the names a mapping file gives them. Nothing about them is verified against any system: check each against your export (HOW-TO-MAP.md).',
  },
  'netsuite-csv': {
    files: { bills: 'bills.csv', purchase_orders: 'purchase_orders.csv', item_receipts: 'item_receipts.csv' },
    columns: {
      bills: { ref: 'Internal ID', invoice_number: 'Reference No.', vendor: 'Vendor', date: 'Date', currency: 'Currency', total: 'Amount (Transaction Total)', po: 'Created From', status: 'Status', line_id: 'Line ID', item: 'Item', description: 'Memo', quantity: 'Quantity', rate: 'Rate', amount: 'Amount' },
      purchase_orders: { ref: 'Internal ID', number: 'Document Number', vendor: 'Vendor', currency: 'Currency', line_id: 'Line ID', item: 'Item', description: 'Memo', quantity: 'Quantity', rate: 'Rate', amount: 'Amount' },
      item_receipts: { ref: 'Internal ID', number: 'Document Number', po: 'Created From', date: 'Date', item: 'Item', quantity: 'Quantity' },
    },
    required: { bills: ['ref', 'invoice_number', 'date', 'total', 'po', 'item', 'quantity', 'rate', 'amount'], purchase_orders: ['number', 'item', 'rate'], item_receipts: ['po', 'item', 'quantity'] },
    status: { pay: ['Paid In Full'], hold: ['Rejected', 'Cancelled'] },
    poPrefix: 'Purchase Order #',
    unverified: 'NetSuite saved-search column names are UNVERIFIED (no published spec fetched): they are a saved search\'s default labels as this package assumes them; rename them with a mapping file.',
  },
  'xero-csv': {
    files: { bills: 'bills.csv', purchase_orders: 'purchase_orders.csv', item_receipts: 'item_receipts.csv' },
    columns: {
      bills: { ref: 'InvoiceNumber', invoice_number: 'InvoiceNumber', vendor: 'ContactName', date: 'InvoiceDate', currency: 'Currency', total: 'Total', tax: 'TaxTotal', po: 'Reference', status: 'Status', item: 'InventoryItemCode', description: 'Description', quantity: 'Quantity', rate: 'UnitAmount', amount: 'LineAmount' },
      purchase_orders: { ref: 'PurchaseOrderNumber', number: 'PurchaseOrderNumber', vendor: 'ContactName', currency: 'Currency', item: 'InventoryItemCode', description: 'Description', quantity: 'Quantity', rate: 'UnitAmount', amount: 'LineAmount' },
      item_receipts: { ref: 'receipt_id', po: 'purchase_order_number', date: 'received_at', item: 'line_ref', quantity: 'quantity' },
    },
    required: { bills: ['invoice_number', 'date', 'total', 'po', 'item', 'quantity', 'rate', 'amount'], purchase_orders: ['number', 'item', 'rate'], item_receipts: ['po', 'item', 'quantity'] },
    status: { pay: ['PAID', 'Paid'], hold: ['VOIDED', 'DELETED', 'Voided', 'Deleted'] },
    unverified: 'Xero CSV column names are UNVERIFIED (Xero\'s help page is script-rendered; no column list was fetched); the API field names (source xero) are the verified ones.',
  },
  'qbo-csv': {
    files: { bills: 'bills.csv', purchase_orders: 'purchase_orders.csv', item_receipts: 'item_receipts.csv' },
    columns: {
      bills: { ref: 'Bill No.', invoice_number: 'Bill No.', vendor: 'Vendor', date: 'Date', currency: 'Currency', total: 'Total', po: 'P.O. #', status: 'Status', item: 'Product/Service', description: 'Memo', quantity: 'Qty', rate: 'Rate', amount: 'Line amount' },
      purchase_orders: { ref: 'P.O. #', number: 'P.O. #', vendor: 'Vendor', currency: 'Currency', item: 'Product/Service', description: 'Memo', quantity: 'Qty', rate: 'Rate', amount: 'Line amount' },
      item_receipts: { ref: 'receipt_id', po: 'purchase_order_number', date: 'received_at', item: 'line_ref', quantity: 'quantity' },
    },
    required: { bills: ['invoice_number', 'date', 'total', 'po', 'item', 'quantity', 'rate', 'amount'], purchase_orders: ['number', 'item', 'rate'], item_receipts: ['po', 'item', 'quantity'] },
    status: { pay: ['Paid'], hold: ['Voided'] },
    unverified: 'QuickBooks Online CSV column names are UNVERIFIED (no CSV spec fetched); the API field names (source qbo) are the verified ones.',
  },
}

/** A buyer's mapping file: { "source": "netsuite-csv", "files"?: {...}, "columns"?: { "bills": { "invoice_number": "Ref #" } }, "status"?: {...} } */
export function applyMapping(base: CsvPreset, mapping: unknown): CsvPreset {
  if (!isObj(mapping)) throw new ExportRefused('the mapping file must be a JSON object')
  const out: CsvPreset = JSON.parse(JSON.stringify(base))
  for (const k of Object.keys(mapping)) if (!['source', 'files', 'columns', 'status', 'ignore', 'notes'].includes(k)) throw new ExportRefused(`mapping: unknown key "${k}" (source, files, columns, status, ignore, notes)`)
  // 2026-10-06: a drafted mapping carries its notes in the file; they are read out with the reading, never acted on
  if (mapping.notes !== undefined) {
    if (!Array.isArray(mapping.notes) || !mapping.notes.every((x: unknown) => typeof x === 'string')) throw new ExportRefused('mapping.notes: a list of sentences')
    out.notes = [...(out.notes ?? []), ...mapping.notes]
  }
  if (mapping.files !== undefined) for (const [kind, name] of Object.entries(mapping.files as object)) {
    if (!(kind in CSV_TARGETS) || typeof name !== 'string') throw new ExportRefused(`mapping.files.${kind}: a file kind (bills, purchase_orders, item_receipts) naming a file`)
    out.files[kind as CsvFileKind] = name
  }
  if (mapping.columns !== undefined) for (const [kind, cols] of Object.entries(mapping.columns as object)) {
    if (!(kind in CSV_TARGETS) || !isObj(cols)) throw new ExportRefused(`mapping.columns.${kind}: an object of our field → your column`)
    for (const [target, col] of Object.entries(cols)) {
      if (!(CSV_TARGETS[kind as CsvFileKind] as readonly string[]).includes(target)) throw new ExportRefused(`mapping.columns.${kind}.${target}: not a field this mapper reads (${CSV_TARGETS[kind as CsvFileKind].join(', ')})`)
      if (typeof col !== 'string' || !col.trim()) throw new ExportRefused(`mapping.columns.${kind}.${target}: a column name`)
      ;(out.columns[kind as CsvFileKind] as Record<string, string>)[target] = col
    }
  }
  if (mapping.status !== undefined) {
    const s = mapping.status as Record<string, unknown>
    if (!isObj(s) || !['pay', 'hold'].every((k) => s[k] === undefined || (Array.isArray(s[k]) && (s[k] as unknown[]).every((x) => typeof x === 'string')))) throw new ExportRefused('mapping.status: { "pay": [...], "hold": [...] }')
    out.status = { pay: (s.pay as string[]) ?? out.status.pay, hold: (s.hold as string[]) ?? out.status.hold }
  }
  if (mapping.ignore !== undefined) {
    if (!Array.isArray(mapping.ignore) || !mapping.ignore.every((x: unknown) => typeof x === 'string')) throw new ExportRefused('mapping.ignore: a list of column names')
    out.ignore = [...(out.ignore ?? []), ...mapping.ignore]
  }
  return out
}

function readCsvSource(dir: string, preset: CsvPreset, ignore: ReadonlySet<string>, monthEnd: string | null): Omit<ExportReading, 'source'> {
  const files: Loaded[] = []
  const unk = new Set<string>(), missing: string[] = [], notes: string[] = [preset.unverified, ...(preset.notes ?? []).map((n) => `mapping note: ${n}`)]
  const read = (kind: CsvFileKind, required: boolean): { rows: Record<string, string>[]; col: (t: string) => string | undefined } | null => {
    const name = preset.files[kind]
    if (!existsSync(join(dir, name))) { if (required) missing.push(`${name} (the ${kind.replace('_', ' ')})`); return null }
    const l = load(dir, name); files.push(l)
    const pop = readPopulationCSV(l.text)
  const columns = pop.columns ?? []
    l.file.records = pop.rows.length
    const cols = preset.columns[kind] as Record<string, string>
    const used = new Set(Object.values(cols))
    for (const c of columns) if (!used.has(c) && !(preset.ignore ?? []).includes(c)) unk.add(`${name}: column "${c}"`)
    for (const t of preset.required[kind]) if (!cols[t] || !columns.includes(cols[t]!)) missing.push(`${name}: column "${cols[t] ?? t}" (${t})`)
    return { rows: pop.rows.map((r) => r.values as Record<string, string>), col: (t: string) => cols[t] }
  }
  const b = read('bills', true), p = read('purchase_orders', true), r = read('item_receipts', false)
  if (!r) notes.push(`no ${preset.files.item_receipts}: every quantity check will abstain or fail`)
  if (!b || !p || missing.length) return finish(files, unk, ignore, missing, [], notes)
  const v = (row: Record<string, string>, f: { col: (t: string) => string | undefined }, t: string): string | null => { const c = f.col(t); return c ? str(row[c]) : null }
  const poRef = (s: string | null): string | null => (s && preset.poPrefix && s.startsWith(preset.poPrefix) ? s.slice(preset.poPrefix.length).trim() : s)
  const statusOf = (s: string | null): { decision: BuyerDecision; from: string } => {
    const low = (s ?? '').toLowerCase()
    if (preset.status.pay.some((x) => x.toLowerCase() === low)) return { decision: 'pay', from: `status "${s}"` }
    if (preset.status.hold.some((x) => x.toLowerCase() === low)) return { decision: 'hold', from: `status "${s}"` }
    return { decision: 'open', from: `status "${s ?? ''}"` }
  }
  const poBy = new Map<string, NPO>()
  for (const row of p.rows) {
    const number = v(row, p, 'number'); if (!number) continue
    let po = poBy.get(number)
    if (!po) { po = { keys: [number, ...(v(row, p, 'ref') ? [v(row, p, 'ref')!] : [])], id: v(row, p, 'ref'), number, vendor: { name: v(row, p, 'vendor') }, currency: v(row, p, 'currency'), lines: [] }; poBy.set(number, po) }
    const item = v(row, p, 'item')
    // 2026-10-06: the line's quantity invoiced before the month, when the mapping names the column and the cell holds a number
    const invoicedBefore = p.col('invoiced_quantity') ? num(v(row, p, 'invoiced_quantity')) : null
    const lineId = v(row, p, 'line_id') ?? item ?? `line-${po.lines.length + 1}`
    // 2026-10-06: a rate per hundred or per thousand (Vista's CurECM C or M) becomes a price per unit; anything else is named
    const pu = p.col('price_per') ? perUnit({ rate: num(v(row, p, 'rate')), quantity: num(v(row, p, 'quantity')), amount: num(v(row, p, 'amount')), raw: v(row, p, 'price_per'), column: p.col('price_per')!, where: `PO ${number} line ${lineId}` }) : null
    const rate = pu && 'rate' in pu ? pu.rate : num(v(row, p, 'rate'))
    po.lines.push({ id: lineId, sku: item, description: v(row, p, 'description'), quantity: num(v(row, p, 'quantity')), unit_price: rate ?? v(row, p, 'rate') ?? 0, amount: num(v(row, p, 'amount')), ...(invoicedBefore !== null ? { invoiced_before: invoicedBefore } : {}),
      ...(p.col('unit') ? { unit: v(row, p, 'unit') } : {}), ...(pu && 'problem' in pu ? { problem: pu.problem } : {}) })
  }
  if (p.col('price_per')) notes.push(`price_per (column ${p.col('price_per')} of ${preset.files.purchase_orders}${b.col('price_per') ? `, ${b.col('price_per')} of ${preset.files.bills}` : ''}): a rate per hundred (C) or per thousand (M) is divided by 100 or 1,000 to a price per unit; a value that is none of E, C or M sends the bill to a person, naming it`)
  if (p.col('unit') && b.col('unit')) notes.push(`unit (columns ${b.col('unit')} and ${p.col('unit')}): a bill line whose unit of measure differs from its PO line's sends the bill to a person, naming both units`)
  if ([...poBy.values()].some((po) => po.lines.some((l) => typeof l.invoiced_before === 'number'))) {
    notes.push(`invoiced_quantity: a PO line's quantity invoiced before the month, plus each earlier bill of the month on that line (a bill marked held is left out), nets each bill's quantity against what was received, line by line`)
  }
  const billBy = new Map<string, NBill>()
  // 2026-10-13: rows with no ref are one bill only when they share the invoice number, the date and the vendor as written. Two
  // bills under one number, on two dates or under two spellings of the vendor, are exactly the duplicate a pilot runs to find:
  // they were merged without a word, reported as a total mismatch, and dropped from the paid count. Now they are separate
  // bills (the later ones' refs name their date and vendor), and the reading says so.
  const keyOf = new Map<string, string>() // invoice number|date|vendor -> ref
  const spans = new Map<string, { dates: Set<string>; vendors: Set<string> }>() // invoice number -> what its unref'd rows carry
  let rowCount = 0
  for (const row of b.rows) {
    const given = v(row, b, 'ref')
    const inv = v(row, b, 'invoice_number')
    if (!given && !inv) continue
    rowCount++
    let ref: string
    if (given) ref = given
    else {
      const date = isoDate(v(row, b, 'date')) ?? '', vendor = (v(row, b, 'vendor') ?? '').trim()
      const k = `${inv}|${date}|${vendor}`
      const s = spans.get(inv!) ?? { dates: new Set<string>(), vendors: new Set<string>() }
      s.dates.add(date); s.vendors.add(vendor); spans.set(inv!, s)
      const seen = keyOf.get(k)
      if (seen) ref = seen
      else {
        ref = [...keyOf.keys()].some((x) => x.startsWith(`${inv}|`)) ? `${inv} (${[date, vendor].filter(Boolean).join(', ')})` : inv!
        keyOf.set(k, ref)
      }
    }
    let bill = billBy.get(ref)
    if (!bill) {
      const total = num(v(row, b, 'total'))
      bill = { ref, invoice_number: inv, vendor: { name: v(row, b, 'vendor') }, po_key: poRef(v(row, b, 'po')), currency: v(row, b, 'currency'), amount: total, amount_major: total, tax: num(v(row, b, 'tax')), issued_at: isoDate(v(row, b, 'date')), lines: [], buyer: statusOf(v(row, b, 'status')) }
      billBy.set(ref, bill)
    }
    // 2026-10-06: the bill line's rate per unit (Vista's ECM), and its unit of measure, when the mapping names the columns
    const pu = b.col('price_per') ? perUnit({ rate: num(v(row, b, 'rate')), quantity: num(v(row, b, 'quantity')), amount: num(v(row, b, 'amount')), raw: v(row, b, 'price_per'), column: b.col('price_per')!, where: 'the line' }) : null
    bill.lines.push({ id: v(row, b, 'line_id'), sku: v(row, b, 'item'), description: v(row, b, 'description'), quantity: num(v(row, b, 'quantity')), unit_price: pu && 'rate' in pu ? pu.rate : num(v(row, b, 'rate')), amount: num(v(row, b, 'amount')) ?? 0,
      ...(b.col('unit') ? { unit: v(row, b, 'unit') } : {}), ...(pu && 'problem' in pu ? { problem: pu.problem } : {}) })
  }
  // 2026-10-13: say which invoice numbers were read as more than one bill, and why ("8 rows, 6 bills; GCS-20417 has rows on two
  // dates under two vendor names")
  const split = [...spans].filter(([, s]) => s.dates.size > 1 || s.vendors.size > 1)
  if (split.length) {
    const n = (k: number): string => ['', 'one', 'two', 'three', 'four', 'five'][k] ?? String(k)
    const why = (s: { dates: Set<string>; vendors: Set<string> }): string => [s.dates.size > 1 ? `on ${n(s.dates.size)} dates` : '', s.vendors.size > 1 ? `under ${n(s.vendors.size)} vendor names` : ''].filter(Boolean).join(' ')
    notes.push(`${rowCount} rows, ${billBy.size} bills; ${split.map(([inv, s]) => `${inv} has rows ${why(s)}`).join('; ')}: read as separate bills, never merged (a "ref" column naming each bill settles which rows are one bill; HOW-TO-MAP.md)`)
  }
  const recBy = new Map<string, NReceipt>()
  for (const row of r?.rows ?? []) {
    const po = poRef(v(row, r!, 'po')); if (!po) continue
    const key = `${v(row, r!, 'number') ?? v(row, r!, 'ref') ?? ''}|${po}`
    let rec = recBy.get(key)
    if (!rec) { rec = { id: v(row, r!, 'ref'), number: v(row, r!, 'number'), po_key: po, received_at: isoDate(v(row, r!, 'date')), lines: [] }; recBy.set(key, rec) }
    rec.lines.push({ sku: v(row, r!, 'item'), quantity: num(v(row, r!, 'quantity')) ?? 0 })
  }
  return finish(files, unk, ignore, missing, assemble([...billBy.values()], [...poBy.values()], [...recBy.values()], monthEnd), notes)
}

function finish(files: Loaded[], unk: Set<string>, ignore: ReadonlySet<string>, missing: string[], bills: MappedBill[], notes: string[]): Omit<ExportReading, 'source'> {
  if (bills.length > EXPORT_LIMITS.maxBills) throw new ExportRefused(`the export holds ${bills.length} bills, over the ${EXPORT_LIMITS.maxBills} cap`)
  const all = [...unk].sort()
  return { files: files.map((l) => l.file), unmapped: all.filter((u) => !ignore.has(u)), ignored: all.filter((u) => ignore.has(u)), missing, bills, notes }
}

/** The source a folder holds, from its file names; undefined when it is not clear (name it with --source). */
export function detectSource(dir: string): SourceId | undefined {
  const has = (re: RegExp) => filesMatching(dir, re).length > 0
  if (has(/^bills(\..+)?\.json$/)) return 'ramp'
  if (has(/^Invoices\.json$/)) return 'xero'
  if (has(/^Bill\.json$/)) return 'qbo'
  return undefined
}

export interface ReadOptions {
  /** YYYY-MM: receipts received after this month's end are left out (the gate would not have seen them) */
  month?: string
  /** acknowledged unmapped keys/columns, exactly as the dry run printed them */
  ignore?: readonly string[]
  /** a CSV source's mapping file (parsed JSON) */
  mapping?: unknown
  /** xero: the Invoice field holding the PO number (default Reference) */
  xeroPoField?: string
}

/** The last day of YYYY-MM, as YYYY-MM-DD. */
export function monthEnd(month: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new ExportRefused(`--month is YYYY-MM (got ${month})`)
  const [y, m] = month.split('-').map(Number) as [number, number]
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
}

/** Read an export folder. Throws ExportRefused on what cannot be read at all; unmapped and missing are in the result. */
export function readExport(dir: string, source: SourceId, opts: ReadOptions = {}): ExportReading {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new ExportRefused(`${dir} is not a folder`)
  const ignore = new Set(opts.ignore ?? [])
  const end = opts.month ? monthEnd(opts.month) : null
  let r: Omit<ExportReading, 'source'>
  if (source === 'ramp') r = readRamp(dir, ignore, end)
  else if (source === 'xero') r = readXero(dir, ignore, end, opts.xeroPoField ?? 'Reference')
  else if (source === 'qbo') r = readQbo(dir, ignore, end)
  else {
    const preset = opts.mapping !== undefined ? applyMapping(CSV_PRESETS[source], opts.mapping) : CSV_PRESETS[source]
    r = readCsvSource(dir, preset, ignore, end)
  }
  return { source, ...r }
}

/** What a mapper needs, for the dry run and the docs: per source, the files and the fields read, verified or not. */
export const MAPPER_SCHEMAS: Record<SourceId, { files: string[]; reads: string[]; verified: string }> = {
  ramp: { files: ['bills*.json', 'purchase_orders*.json', 'item_receipts*.json (optional)'], reads: ['Bill: id, invoice_number, vendor{id,name}, amount{amount,currency_code,minor_unit_conversion_rate}, issued_at, purchase_order_id, inventory_line_items[] (else line_items[]), status, status_summary, approval_status', 'ApiBillInventoryLineItem: id, purchase_order_line_item_id, quantity, unit_price, amount, memo', 'ApiPurchaseOrderResource: id, purchase_order_number, vendor_id, amount.currency_code, line_items[]', 'ApiPurchaseOrderLineItem: id, external_id, description, quantity, unit_price, amount', 'ApiItemReceiptResource: id, item_receipt_number, purchase_order_id, received_at, line_items[{purchase_order_line_item_id, quantity}]'], verified: 'field names verified against the Ramp Developer API OpenAPI file' },
  xero: { files: ['Invoices.json (Type ACCPAY)', 'PurchaseOrders.json', 'item_receipts.csv (optional; this package\'s format)'], reads: ['Invoice: InvoiceID, InvoiceNumber, Contact{ContactID,Name}, Date, CurrencyCode, Total, TotalTax, Reference (the PO, by default), Status, LineItems[]', 'LineItem: LineItemID, ItemCode, Description, Quantity, UnitAmount, LineAmount', 'PurchaseOrder: PurchaseOrderID, PurchaseOrderNumber, Contact, CurrencyCode, LineItems[]'], verified: 'field names verified against the Xero Accounting OpenAPI file; the bill-to-PO link (Reference) is not' },
  qbo: { files: ['Bill.json', 'PurchaseOrder.json', 'item_receipts.csv (optional; this package\'s format)'], reads: ['Bill: Id, DocNumber, VendorRef, TxnDate, CurrencyRef, TotalAmt, Balance, LinkedTxn[], Line[] (DetailType ItemBasedExpenseLineDetail: ItemRef, Qty, UnitPrice; Amount; LinkedTxn TxnId/TxnType/TxnLineId)', 'PurchaseOrder: Id, DocNumber, VendorRef, CurrencyRef, Line[]'], verified: 'field names verified against Finance.xsd (Id and the other base fields live in IntuitBaseTypes.xsd, not fetched)' },
  'netsuite-csv': { files: ['bills.csv', 'purchase_orders.csv', 'item_receipts.csv'], reads: Object.entries(CSV_PRESETS['netsuite-csv'].columns).map(([k, c]) => `${k}: ${Object.values(c).join(', ')}`), verified: 'UNVERIFIED column names' },
  'xero-csv': { files: ['bills.csv', 'purchase_orders.csv', 'item_receipts.csv'], reads: Object.entries(CSV_PRESETS['xero-csv'].columns).map(([k, c]) => `${k}: ${Object.values(c).join(', ')}`), verified: 'UNVERIFIED column names' },
  'qbo-csv': { files: ['bills.csv', 'purchase_orders.csv', 'item_receipts.csv'], reads: Object.entries(CSV_PRESETS['qbo-csv'].columns).map(([k, c]) => `${k}: ${Object.values(c).join(', ')}`), verified: 'UNVERIFIED column names' },
  'generic-csv': { files: ['bills.csv', 'purchase_orders.csv', 'item_receipts.csv'], reads: Object.entries(CSV_PRESETS['generic-csv'].columns).map(([k, c]) => `${k}: ${Object.values(c).join(', ')}`), verified: 'this package\'s own column names, or a mapping file\'s; nothing verified against any system' },
}
