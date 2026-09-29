/**
 * The constructed set for the purchase-order LINE_PRICE `amount` → `price` change (E-INVOICE-2, 2026-09-28).
 * Pre-registered in "Purchase-order LINE_PRICE", pre-registration, 2026-09-28, before this file existed. CONSTRUCTED,
 * labelled by construction; not field data.
 *
 * Every order foots (subtotal = Σ amounts, total = subtotal + tax), so only the line check MATH_INT can differ.
 * CLEAN: each line amount = qty × unit price, rounded half-up to the cent; at least one unit price per order has 3–4
 * decimals, chosen so the cent-rounded price moves the product past the default tolerance. ERROR: one line amount is
 * wrong, either computed with the cent-rounded price (E1–E3) or by an ordinary slip (E4–E6).
 */
import type { LabeledCase } from '../../src/declarative/measure'

export interface PoCase extends LabeledCase { id: string; why: string }

type Item = { qty: number; unit_price: number | string; amount: number }
const r2 = (x: number): number => Math.round((x + Number.EPSILON) * 100) / 100
function order(items: Item[], taxRate = 0.1): Record<string, unknown> {
  const subtotal = r2(items.reduce((a, i) => a + i.amount, 0))
  const tax = r2(subtotal * taxRate)
  return { items, subtotal, tax, total: r2(subtotal + tax) }
}
const clean = (id: string, why: string, items: Item[]): PoCase => ({ id, why, label: 'CLEAN', extraction: order(items) })
const error = (id: string, why: string, items: Item[]): PoCase => ({ id, why, label: 'ERROR', extraction: order(items) })

export const PO_PRICE_SET: PoCase[] = [
  clean('C1-eighth', '1,000 × 0.125 = 125.00', [{ qty: 1000, unit_price: 0.125, amount: 125 }]),
  clean('C2-three-decimals', '300 × 3.335 = 1,000.50', [{ qty: 300, unit_price: 3.335, amount: 1000.5 }]),
  clean('C3-four-decimals-two-lines', '2,500 × 0.0875 = 218.75, plus 1 × 50', [{ qty: 2500, unit_price: 0.0875, amount: 218.75 }, { qty: 1, unit_price: 50, amount: 50 }]),
  clean('C4-four-decimals', '200 × 1.2345 = 246.90', [{ qty: 200, unit_price: 1.2345, amount: 246.9 }]),
  clean('C5-rounded-product', '64 × 0.4995 = 31.968 → 31.97', [{ qty: 64, unit_price: 0.4995, amount: 31.97 }]),
  clean('C6-mixed-lines', '3 × 20 = 60, 150 × 0.333 = 49.95', [{ qty: 3, unit_price: 20, amount: 60 }, { qty: 150, unit_price: 0.333, amount: 49.95 }]),
  clean('C7-string-price', '1,000 × "0.125" = 125.00 (a plain decimal string)', [{ qty: 1000, unit_price: '0.125', amount: 125 }]),
  clean('C8-string-price', '40 × "2.4975" = 99.90 (a plain decimal string)', [{ qty: 40, unit_price: '2.4975', amount: 99.9 }]),
  error('E1-rounded-price', 'amount = 1,000 × 0.13 (the cent-rounded 0.125)', [{ qty: 1000, unit_price: 0.125, amount: 130 }]),
  error('E2-rounded-price', 'amount = 200 × 1.23 (the cent-rounded 1.2345)', [{ qty: 200, unit_price: 1.2345, amount: 246 }]),
  error('E3-rounded-price', 'amount = 150 × 0.33 (the cent-rounded 0.333), second line', [{ qty: 3, unit_price: 20, amount: 60 }, { qty: 150, unit_price: 0.333, amount: 49.5 }]),
  error('E4-plus-one', '125.00 + 1.00', [{ qty: 1000, unit_price: 0.125, amount: 126 }]),
  error('E5-transposition', '597.92 written 579.92 (48 × 12.4567)', [{ qty: 48, unit_price: 12.4567, amount: 579.92 }]),
  error('E6-other-line', 'the second line carries the first line\'s amount', [{ qty: 3, unit_price: 20, amount: 60 }, { qty: 150, unit_price: 0.333, amount: 60 }]),
]
