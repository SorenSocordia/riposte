/**
 * The labeled benchmark corpus — ground truth for the Verification Index.
 *
 * Each case carries a LABEL: is the document actually wrong (`ERROR`) or actually fine (`CLEAN`)? The Index measures the
 * verifier against that truth — how often it false-alarms (FP), how often it misses a real error (FN), how often it
 * honestly abstains. A verifier that is never wrong but abstains on everything is useless; one that never abstains but
 * false-alarms is worse. The Index publishes all three so nobody has to trust an adjective.
 *
 * v0 is a small, hand-labeled synthetic set — it proves the machine and the scoring. The CREDIBLE number needs real,
 * held-out documents (roadmap 1.4); those load through the same shape. Every label here is defensible in one sentence.
 */

import type { Json, VerifyOptions } from '../index.js'

export type Label = 'CLEAN' | 'ERROR'

export interface LabeledCase {
  name: string
  label: Label
  /** One sentence justifying the label — so a reader can audit the ground truth, not just trust it. */
  why: string
  extraction: Json
  options?: VerifyOptions
}

const NOW = () => new Date('2026-09-22T00:00:00Z')
const opt = (o: Omit<VerifyOptions, 'now'> = {}): VerifyOptions => ({ ...o, now: NOW })

const cleanInvoice: Json = {
  invoice_number: 'INV-1001', currency: 'USD', invoice_date: '2026-09-15',
  line_items: [
    { description: 'Consulting', quantity: 10, unit_price: 150, amount: 1500 },
    { description: 'Travel', quantity: 1, unit_price: 250.5, amount: 250.5 },
  ],
  totals: { subtotal: 1750.5, tax_rate: 0.0825, tax: 144.42, total: 1894.92 },
}

const brokenInvoice: Json = {
  invoice_number: 'INV-1002', currency: 'USD', invoice_date: '2026-09-15',
  line_items: [
    { description: 'Consulting', quantity: 10, unit_price: 150, amount: 1500 },
    { description: 'Travel', quantity: 1, unit_price: 250.5, amount: 275 }, // amount ≠ price×qty
  ],
  totals: { subtotal: 1750.5, tax_rate: 0.0825, tax: 150, total: 1900.5 }, // tax ≠ subtotal×rate
}

const roundingInvoice: Json = {
  invoice_number: 'INV-1003', currency: 'USD', invoice_date: '2026-09-15',
  line_items: [
    { description: 'Consulting', quantity: 10, unit_price: 150, amount: 1500 },
    { description: 'Travel', quantity: 1, unit_price: 250.1, amount: 250.1 },
  ],
  totals: { subtotal: 1750.5, tax_rate: 0, tax: 0, total: 1750.5 }, // 40-cent rounding drift on subtotal
}

const overTotal: Json = {
  invoice_number: 'INV-1004', currency: 'USD',
  line_items: [{ description: 'Widget', quantity: 2, unit_price: 100, amount: 200 }],
  totals: { subtotal: 200, tax_rate: 0, tax: 0, total: 500 }, // total ≠ subtotal (+250 phantom)
}

const singleLine: Json = {
  invoice_number: 'INV-2001', currency: 'USD', invoice_date: '2026-09-15',
  line_items: [{ description: 'Consulting', quantity: 10, unit_price: 150, amount: 1500 }],
  totals: { subtotal: 1500, tax_rate: 0.0825, tax: 123.75, total: 1623.75 },
}
const contractOk: Json = { rates: [{ rate: 150 }], max_amount: 5000, effective_date: '2026-01-01', expiration_date: '2026-12-31' }
const contractLowRate: Json = { ...contractOk, rates: [{ rate: 140 }] } // invoice bills 150 → overcharge

const dupInvoice: Json = { ...singleLine, prior_invoice_ids: ['INV-1900', 'INV-2001'] } // exact prior
const nearDupInvoice: Json = { ...singleLine, prior_invoice_ids: ['INV-1900', 'INV-002001'] } // formatting variant

const eu: Json = {
  invoice_number: 'INV-EU-7', currency: 'EUR',
  line_items: [{ description: 'Widget', quantity: '2', unit_price: '625,00 €', amount: '1.250,00 €' }],
  totals: { subtotal: '1.250,00', tax_rate: '19%', tax: '237,50', total: '1.487,50' },
}

const cleanPayApp: Json = {
  application_number: 2, currency: 'USD',
  original_contract_sum: 95000, net_change_orders: 5000, contract_sum_to_date: 100000,
  schedule_of_values: [
    { item_no: '1', description: 'Mobilization', scheduled_value: 10000, previous: 10000, this_period: 0, materials_stored: 0, completed_to_date: 10000, percent_complete: 100, balance_to_finish: 0, retainage: 1000 },
    { item_no: '2', description: 'Concrete', scheduled_value: 50000, previous: 20000, this_period: 15000, materials_stored: 5000, completed_to_date: 40000, percent_complete: 80, balance_to_finish: 10000, retainage: 4000 },
    { item_no: '3', description: 'Framing', scheduled_value: 40000, previous: 0, this_period: 12000, materials_stored: 0, completed_to_date: 12000, percent_complete: 30, balance_to_finish: 28000, retainage: 1200 },
  ],
  total_completed_and_stored: 62000, retainage_rate: '10%', total_retainage: 6200,
  total_earned_less_retainage: 55800, less_previous_certificates: 27000, current_payment_due: 28800,
  balance_to_finish_including_retainage: 44200,
}
const overbilledPayApp: Json = {
  ...cleanPayApp, application_number: 3,
  schedule_of_values: [
    { item_no: '1', description: 'Mobilization', scheduled_value: 10000, previous: 10000, this_period: 0, materials_stored: 0, completed_to_date: 10000, percent_complete: 100, balance_to_finish: 0, retainage: 1000 },
    { item_no: '2', description: 'Concrete', scheduled_value: 40000, previous: 20000, this_period: 45000, materials_stored: 0, completed_to_date: 45000, percent_complete: 112.5, balance_to_finish: -5000, retainage: 4000 }, // G > C: billed past scheduled value
    { item_no: '3', description: 'Framing', scheduled_value: 40000, previous: 0, this_period: 12000, materials_stored: 0, completed_to_date: 12000, percent_complete: 30, balance_to_finish: 28000, retainage: 1200 },
  ],
}

export const CORPUS: LabeledCase[] = [
  { name: 'clean-invoice', label: 'CLEAN', why: 'lines foot, tax and total are exact', extraction: cleanInvoice, options: opt() },
  { name: 'broken-invoice', label: 'ERROR', why: 'a line amount and the tax are both wrong', extraction: brokenInvoice, options: opt() },
  { name: 'rounding-drift', label: 'CLEAN', why: 'a 40-cent rounding difference is not an error', extraction: roundingInvoice, options: opt() },
  { name: 'over-total', label: 'ERROR', why: 'the grand total exceeds the subtotal by 250 with no tax', extraction: overTotal, options: opt() },
  { name: 'eu-format', label: 'CLEAN', why: 'European formatting normalizes and foots exactly', extraction: eu, options: opt() },
  { name: 'contract-ok', label: 'CLEAN', why: 'the billed rate matches the contract', extraction: singleLine, options: opt({ references: { contract: contractOk } }) },
  { name: 'over-contract-rate', label: 'ERROR', why: 'billed 150/unit against a 140 contract rate', extraction: singleLine, options: opt({ references: { contract: contractLowRate } }) },
  { name: 'exact-duplicate', label: 'ERROR', why: 'this invoice number was already processed', extraction: dupInvoice, options: opt() },
  { name: 'near-duplicate', label: 'ERROR', why: 'a prior invoice number is the same modulo formatting (INV-002001)', extraction: nearDupInvoice, options: opt() },
  { name: 'clean-payapp', label: 'CLEAN', why: 'every G702/G703 line foots', extraction: cleanPayApp, options: opt({ ruleset: 'pay-app' }) },
  { name: 'overbilled-payapp', label: 'ERROR', why: 'a line is billed past its scheduled value (G > C)', extraction: overbilledPayApp, options: opt({ ruleset: 'pay-app' }) },
]
