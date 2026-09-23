/**
 * CORD (naver-clova-ix/cord-v2, CC-BY-4.0) → our extraction shape.
 *
 * CORD is a real receipt-parsing dataset. Its `ground_truth.gt_parse` gives menu line items and a totals block. We map
 * it to what the invoice ruleset checks — this is how a real document (not a hand-written fixture) reaches the verifier.
 *
 * Field reality, measured from the data (not assumed): `menu[].price` is the LINE TOTAL (Σ prices == subtotal on every
 * sampled receipt), `menu[].cnt` is a count like "1 x", the totals block carries subtotal / tax / service / discount /
 * total. We therefore bind `amount` (not unit_price) per line, so per-line MATH_INT honestly abstains (no unit price) and
 * the document footing (Σ amounts = subtotal) and total (subtotal + tax + service − discount) run for real.
 *
 * Rupiah/receipt number formatting ("75,000", "40,000.") is left as strings — the forensic normalizer handles it.
 */

import type { Json } from '../../index.js'

interface CordMenuItem { nm?: string; cnt?: string; price?: string | number; unitprice?: string | number }
interface CordSubTotal { subtotal_price?: string | number; tax_price?: string | number; service_price?: string | number; discount_price?: string | number }
interface CordGtParse { menu?: CordMenuItem | CordMenuItem[]; sub_total?: CordSubTotal; total?: { total_price?: string | number } }

/** Parse a CORD count like "1 x", "2x", "3 X" → a number, or undefined. */
function count(cnt: string | undefined): number | undefined {
  if (typeof cnt !== 'string') return undefined
  const m = cnt.match(/(\d+(?:[.,]\d+)?)/)
  return m ? Number(m[1]!.replace(',', '.')) : undefined
}

export function cordToExtraction(gt: CordGtParse, id: string): Json {
  const rawMenu = gt.menu
  const menu: CordMenuItem[] = Array.isArray(rawMenu) ? rawMenu : rawMenu ? [rawMenu] : []
  const line_items = menu
    .filter(m => m && typeof m === 'object')
    .map(m => {
      const item: Json = {}
      if (m.nm !== undefined) item.description = m.nm
      const q = count(m.cnt)
      if (q !== undefined) item.quantity = q
      if (m.unitprice !== undefined) item.unit_price = m.unitprice
      if (m.price !== undefined) item.amount = m.price // CORD price = line total (measured)
      return item
    })

  const st = gt.sub_total ?? {}
  const totals: Json = {}
  if (st.subtotal_price !== undefined) totals.subtotal = st.subtotal_price
  if (st.tax_price !== undefined) totals.tax = st.tax_price
  if (st.service_price !== undefined) totals.service_charge = st.service_price
  if (st.discount_price !== undefined) totals.discount = st.discount_price
  if (gt.total?.total_price !== undefined) totals.total = gt.total.total_price

  return { invoice_number: id, currency: 'IDR', line_items, totals }
}

/** Shape of the saved CORD sample file (records with real ground_truth). */
export interface CordSampleFile {
  source_dataset: string
  license: string
  records: { row_idx: number; ground_truth: { gt_parse: CordGtParse } }[]
}

export function cordSampleToCases(file: CordSampleFile): { name: string; extraction: Json }[] {
  return file.records.map(r => ({ name: `cord-${r.row_idx}`, extraction: cordToExtraction(r.ground_truth.gt_parse, `CORD-${r.row_idx}`) }))
}
