/**
 * The structured AP input the text path's own reading implies (2026-10-03): parse the three texts the way
 * verifyInvoiceMatch does, match lines the way it does, and write what it read as an ApStructuredInput. Used to show the two
 * paths agree on the same facts (a determinism check, not an accuracy claim), and to move a text case into structured form.
 *
 * Returns a reason instead of an input whenever the text path's reading carries an ambiguity structured input cannot state:
 * no invoice or PO number, several PO numbers, several totals, an amount it could not classify, several freight amounts, a
 * weak or near-tied line match, a line that does not recompute and carries an adjustment marker, mixed currencies. On those
 * the text path abstains for reasons of reading, which structured input does not have.
 *
 * 2026-10-05: it reads the text as the current engine does (a stated total only from an amount on a total line,
 * ./parse.ts strictTotals), and it returns a reason when the invoice does not name the purchase order's vendor (./vendor.ts
 * readInvoiceVendor): the text path's reading then has no vendor for the bill, which structured input cannot state.
 *
 * 2026-10-13: under engine 0.7.0 it reads as that engine does (./v070.ts): the sender in angle brackets and the other vendor
 * rules, every sentence about where payment goes, a tax line (declined: the conversion writes no bill.tax), and the item each
 * line names (a line that does not name its PO line's item is declined).
 *
 * 2026-10-19: under ruleset 0.4.0 (./index.ts readsAs040) it declines what that ruleset sends to a person: the opening step of a
 * payment redirection, a payment line found once read as spelled, and a Reply-To at another domain than its sender's.
 */
import { adjustmentMarker, minorUnitDigits, recomputeLine } from './line-math.js'
import { ENGINE_VERSION } from '../version.js'
import { readsAs070 } from './v070.js'
import { matchLines, matchLines070, parseGoodsReceipt, parseInvoice, parsePurchaseOrder } from './parse.js'
import { readsAs030, readsAs040, resolveApRuleset, type ApDocuments } from './index.js'
import { validateApInput, type ApStructuredInput } from './structured.js'
import { readRemittance } from './remittance.js'
import { textVendorPasses } from './vendor.js'

export function structuredFromText(d: ApDocuments, opts: { ruleset?: string | { id: string; version: string } } = {}): { ok: true; input: ApStructuredInput } | { ok: false; reason: string } {
  const no = (reason: string) => ({ ok: false as const, reason })
  // 2026-10-13: under engine 0.7.0 a tax line and a suffixed invoice number are read too (./v070.ts)
  const v070 = readsAs070(ENGINE_VERSION)
  // 2026-10-14: under ruleset 0.3.0 (./index.ts readsAs030) it reads as that ruleset does: a subtotal line, a price per thousand
  // or hundred, a distributor's invoice number, a pole count, and the announced-change sentences
  const v030 = readsAs030(resolveApRuleset(opts.ruleset, ENGINE_VERSION))
  // 2026-10-19: under ruleset 0.4.0 the opening step, the spelled reading and the Reply-To are read too
  const v040 = readsAs040(resolveApRuleset(opts.ruleset, ENGINE_VERSION))
  const inv = parseInvoice(d.invoice, v070 ? { strictTotals: true, readTax: true, suffixNumbers: true, ...(v030 ? { subtotals: true, pricePer: true, plainNumbers: true } : {}) } : { strictTotals: true })
  const match = v030 ? { poles: true } : {}
  const po = parsePurchaseOrder(d.purchase_order)
  const gr = parseGoodsReceipt(d.goods_receipt)
  if (!inv.invoiceNumber || !po.number) return no('no invoice number or PO number read')
  if (inv.poNumbers.length > 1) return no('the invoice cites several PO numbers')
  if (inv.ambiguousTotal || inv.unclassified.length || inv.freight.length > 1) return no('an amount the text path could not classify')
  if (new Set(inv.totals.map((t) => t.value)).size !== 1) return no('no single stated total')
  if (inv.tax.length) return no('a tax line (the conversion writes no bill.tax)')
  if (!inv.lines.length || inv.lines.length !== po.lines.length) return no('the invoice and PO line counts differ')
  // ruleset 0.3.0: a subtotal line that is not the lines' sum is a reading the text path sends to a person
  if (v030 && inv.subtotals.some((s) => Math.abs(s.value - inv.lines.reduce((a, l) => a + l.amount, 0)) > 0.005 && !(inv.freight.length === 1 && Math.abs(s.value - inv.lines.reduce((a, l) => a + l.amount, 0) - inv.freight[0]!.value) <= 0.005))) return no('a subtotal line that is not the lines\' sum')
  const m = matchLines(inv.lines, po.lines, match)
  if (!m || m.minScore < 0.34 || m.margin < 0.25) return no('a weak or near-tied line match')
  if (v070 && matchLines070(inv.lines, po.lines, match).unmatched.length) return no('an invoice line that does not name the item of the PO line it matches')
  const digitsOf = (pl: (typeof po.lines)[number]): string | null => d.purchase_order.slice(pl.span.start, pl.span.end).match(/\bunit\s*([A-Z]{3})\b/)?.[1] ?? null
  const curs = [...new Set(po.lines.map(digitsOf))]
  if (curs.length !== 1) return no('mixed currencies on the PO lines')
  const currency = curs[0] ?? undefined
  // A marker changes the text path's answer only on a line whose recompute FAILs (it abstains there).
  for (const l of inv.lines) {
    const r = recomputeLine({ quantity: l.qty, unit_price: l.unit, amount: l.amount, minor_digits: minorUnitDigits(currency) })
    if (r.ok && r.outcome === 'FAIL' && adjustmentMarker(d.invoice.slice(l.span.start, l.span.end))) return no('a line that does not recompute carries an adjustment marker')
  }
  const vendor = d.purchase_order.match(/Vendor:\s*([^|\n]+)/)?.[1]?.trim()
  // 2026-10-06: the text path's vendor reading now also weighs the sender's domain (a look-alike, or another domain than
  // the one the purchase order names), and it reads the bill's payment details; structured input can state neither
  if (vendor && !textVendorPasses(d.invoice, d.purchase_order, d.history, v070, v040)) return no(v040 ? 'the invoice does not name the purchase order\'s vendor, or its sender writes from a look-alike, a free-mail or another domain, or its Reply-To writes from another domain than its sender' : 'the invoice does not name the purchase order\'s vendor, or its sender writes from a look-alike, a free-mail or another domain')
  if (readRemittance(d.invoice, v070 ? { sentences: true, vendor: vendor ?? null, ...(v030 ? { announced: true } : {}), ...(v040 ? { opening: true } : {}) } : {}).length) return no(v040 ? 'the invoice carries a payment-redirection line (a change of payment details, an announced change or a promise of payment instructions, the opening step of a payment redirection, bank-account details, a payment app, a link to pay at, or a payee email or phone, read as written or as spelled)' : 'the invoice carries a payment-redirection line (a change of payment details, an announced change or a promise of payment instructions, bank-account details, a payment app, a link to pay at, or a payee email or phone)')
  const poOf = new Map(m.pairs.map(([i, j]) => [i, j]))
  const input: ApStructuredInput = {
    schema: 'riposte.ap-input/0.1.0',
    bill: {
      invoice_number: inv.invoiceNumber.value, vendor: vendor ? { name: vendor } : {},
      ...(inv.poNumbers.length ? { purchase_order_number: inv.poNumbers[0]!.value } : {}),
      ...(currency ? { currency } : {}), amount: inv.totals[0]!.value, ...(inv.freight.length ? { freight: inv.freight[0]!.value } : {}),
      line_items: inv.lines.map((l, i) => ({ purchase_order_line_item_id: `L${po.lines[poOf.get(i)!]!.index}`, description: l.name, quantity: l.qty, unit_price: l.unit, amount: l.amount })),
    },
    purchase_order: {
      purchase_order_number: po.number.value, ...(vendor ? { vendor: { name: vendor } } : {}), ...(currency ? { currency } : {}),
      ...(po.freightAllowed !== null ? { freight_allowed: po.freightAllowed } : {}),
      line_items: po.lines.map((pl) => ({ id: `L${pl.index}`, description: pl.name, quantity: pl.qty, unit_price: pl.unit })),
    },
    item_receipts: gr.length ? [{ line_items: gr.map((r) => ({ purchase_order_line_item_id: `L${r.index}`, quantity: r.received })) }] : [],
  }
  if (d.history) {
    input.payment_history = d.history.map((h) => ({
      invoice_number: h.invoice_number, ...(h.vendor ? { vendor: h.vendor } : {}), ...(h.po_number ? { purchase_order_number: h.po_number } : {}),
      ...(h.no_purchase_order === true && !h.po_number ? { no_purchase_order: true } : {}),
      ...(h.total !== undefined ? { amount: h.total } : {}), ...(h.paid_on ? { paid_at: h.paid_on } : {}),
    }))
  }
  const v = validateApInput(input)
  return v.ok ? { ok: true, input } : no(`the reading does not validate as structured input: ${v.errors[0]!.code} at ${v.errors[0]!.field}`)
}
