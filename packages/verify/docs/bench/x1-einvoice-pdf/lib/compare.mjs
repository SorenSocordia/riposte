// Field-level comparison of an extraction against the printed truth (both in the ruleset JSON shape).
// status: ok | wrong | missing (truth has it, extraction omitted it) | extra (extraction has a value the truth lacks)
const DOC = ['invoice_number', 'issue_date', 'currency', 'amount_currency', 'seller_name', 'buyer_name',
  'line_extension_amount', 'allowance_total_amount', 'charge_total_amount', 'tax_exclusive_amount', 'tax_amount',
  'tax_inclusive_amount', 'prepaid_amount', 'payable_rounding_amount', 'payable_amount']
const LINE = ['id', 'invoiced_quantity', 'price_amount', 'base_quantity', 'line_extension_amount', 'line_allowance_amount', 'line_charge_amount']
const VBD = ['category', 'rate', 'taxable_amount', 'tax_amount']
export const NUMERIC_DOC = new Set(DOC.slice(6))

const eq = (a, b) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-9 : String(a) === String(b))
function cmp(field, t, e, rows) {
  const has = (x) => x !== undefined && x !== null
  if (!has(t) && !has(e)) return
  rows.push({ field, truth: has(t) ? t : null, got: has(e) ? e : null, status: !has(e) ? 'missing' : !has(t) ? 'extra' : eq(t, e) ? 'ok' : 'wrong' })
}
export function compareExtraction(truth, got) {
  const rows = []
  for (const k of DOC) cmp(k, truth[k], got[k], rows)
  const n = Math.max(truth.lines?.length ?? 0, got.lines?.length ?? 0)
  for (let i = 0; i < n; i++) for (const k of LINE) cmp(`lines[${i}].${k}`, truth.lines?.[i]?.[k], got.lines?.[i]?.[k], rows)
  const v = Math.max(truth.vat_breakdown?.length ?? 0, got.vat_breakdown?.length ?? 0)
  for (let i = 0; i < v; i++) for (const k of VBD) cmp(`vat_breakdown[${i}].${k}`, truth.vat_breakdown?.[i]?.[k], got.vat_breakdown?.[i]?.[k], rows)
  const c = { ok: 0, wrong: 0, missing: 0, extra: 0 }
  for (const r of rows) c[r.status]++
  return { rows, counts: c, line_count: { truth: truth.lines?.length ?? 0, got: got.lines?.length ?? 0 } }
}
