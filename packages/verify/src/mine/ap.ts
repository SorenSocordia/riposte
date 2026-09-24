/**
 * AP adapter: Distil-style AP cases (`{ id, input, decision }`, where `input` is the three-document layout
 * "INVOICE MESSAGE … PURCHASE ORDER (ERP) … GOODS RECEIPT (ERP) …") → the miner's case table, via the existing AP parser.
 *
 * This is the Oracle-AP prototype's extraction layer, unchanged (see docs/BENCHMARK-MINE.md). The same
 * reads and the same exclusions happen in the same order, and the per-document arithmetic is done by the miner in the same
 * order. So on the same data, the product miner's output is the prototype's. The extraction plays the part of a
 * customer's ERP fields. It is not what the miner tests. Cases it cannot extract are EXCLUDED and counted, never guessed.
 */

import { splitApLayout } from '../ap/index.js'
import { matchLines, parseGoodsReceipt, parseInvoice, parsePurchaseOrder } from '../ap/parse.js'
import type { CaseTable, ExcludedCase, MineCase, MineSchema } from './types.js'

/** One labelled AP case in the Distil layout. `decision` is the gold label: 'approve' | 'hold_*'. */
export interface DistilApCase { id?: string | number; input: string; decision: string }

/**
 * The AP schema: the prototype's frozen field set, with product names.
 *   line:     inv_qty, po_qty, rcv_qty (quantities) · inv_price, po_price (unit prices) · inv_amount (invoice line amount)
 *   document: total (stated) · freight (Σ freight lines) · freight_allowed (PO) · inv_po_numbers (cited) · po_number (PO's own)
 */
export const AP_MINE_SCHEMA: MineSchema = {
  approve: 'approve',
  lines: {
    inv_qty: { type: 'qty', source: 'invoice' },
    po_qty: { type: 'qty', source: 'po' },
    rcv_qty: { type: 'qty', source: 'receipt' },
    inv_price: { type: 'money', role: 'price', source: 'invoice' },
    po_price: { type: 'money', role: 'price', source: 'po' },
    inv_amount: { type: 'money', role: 'amount', source: 'invoice' },
  },
  fields: {
    total: { type: 'money', role: 'total', source: 'invoice' },
    freight: { type: 'money', role: 'extra', source: 'invoice' },
    freight_allowed: { type: 'bool', source: 'po' },
    inv_po_numbers: { type: 'ids', source: 'invoice' },
    po_number: { type: 'id', source: 'po' },
  },
}

export function apCasesToTable(input: readonly DistilApCase[]): CaseTable {
  const cases: MineCase[] = []
  const excluded: ExcludedCase[] = []
  input.forEach((c, i) => {
    if (!c || typeof c !== 'object') { excluded.push({ id: `#${i + 1}`, label: '', why: 'not an object' }); return }
    const id = c.id === undefined || c.id === null ? `#${i + 1}` : String(c.id)
    const label = String(c.decision)
    const ex = (why: string): void => { excluded.push({ id, label, why }) }
    if (typeof c.input !== 'string') return ex('no input text')
    const docs = splitApLayout(c.input)
    if (!docs) return ex('layout')
    const inv = parseInvoice(docs.invoice), po = parsePurchaseOrder(docs.purchase_order), rcv = parseGoodsReceipt(docs.goods_receipt)
    const m = matchLines(inv.lines, po.lines)
    if (!m) return ex('line match')
    const totals = [...new Set(inv.totals.map((t) => t.value))]
    if (totals.length !== 1) return ex(`${totals.length} distinct totals`)
    if (inv.unclassified.length || inv.ambiguousTotal) return ex('unclassified amount')
    if (!po.number) return ex('PO number unreadable')
    const lines: Record<string, unknown>[] = []
    for (const [a, b] of m.pairs) {
      const il = inv.lines[a]!, pl = po.lines[b]!
      const r = rcv.find((x) => x.index === pl.index)
      if (!r) return ex('receipt line missing')
      lines.push({ inv_qty: il.qty, po_qty: pl.qty, rcv_qty: r.received, inv_price: il.unit, po_price: pl.unit, inv_amount: il.amount })
    }
    cases.push({
      id, label, lines,
      fields: {
        total: totals[0]!,
        freight: inv.freight.reduce((acc, f) => acc + f.value, 0),
        freight_allowed: po.freightAllowed === true,
        inv_po_numbers: inv.poNumbers.map((p) => p.value),
        po_number: po.number.value,
      },
    })
  })
  return { cases, excluded }
}
