/**
 * Golden fixtures for the invoice ruleset. Every fixture states what the verifier MUST say about it.
 * When a real-world invoice breaks a rule we didn't anticipate, it becomes a fixture here first.
 */

export type Json = Record<string, unknown>

export const FIXED_NOW = () => new Date('2026-09-22T00:00:00Z')

/** Foots exactly: 1500 + 250.5 = 1750.5; tax 1750.5 × 0.0825 = 144.41625 → stated 144.42; total 1894.92. */
export const clean: Json = {
  invoice_number: 'INV-1001', currency: 'USD', invoice_date: '2026-09-15',
  line_items: [
    { description: 'Consulting', quantity: 10, unit_price: 150, amount: 1500 },
    { description: 'Travel', quantity: 1, unit_price: 250.5, amount: 250.5 },
  ],
  totals: { subtotal: 1750.5, tax_rate: 0.0825, tax: 144.42, total: 1894.92 },
}

/** Three independent errors: line[1] amount ≠ rate×qty; subtotal doesn't foot; tax ≠ subtotal×rate. Bottom line coheres with the (wrong) subtotal+tax. */
export const broken: Json = {
  invoice_number: 'INV-1002', currency: 'USD', invoice_date: '2026-09-15',
  line_items: [
    { description: 'Consulting', quantity: 10, unit_price: 150, amount: 1500 },
    { description: 'Travel', quantity: 1, unit_price: 250.5, amount: 275 },
  ],
  totals: { subtotal: 1750.5, tax_rate: 0.0825, tax: 150, total: 1900.5 },
}

/** European number formatting and a percent-string tax rate. 1250 × 0.19 = 237.5; total 1487.5. */
export const eu: Json = {
  invoice_number: 'INV-EU-7', currency: 'EUR',
  line_items: [{ description: 'Widget', quantity: '2', unit_price: '625,00 €', amount: '1.250,00 €' }],
  totals: { subtotal: '1.250,00', tax_rate: '19%', tax: '237,50', total: '1.487,50' },
}

/** A 40-cent rounding drift on a ~$1750 subtotal (lines sum 1750.10, subtotal states 1750.50). Within 0.05% ($0.875): PASS as rounding. */
export const roundingDrift: Json = {
  invoice_number: 'INV-RND-1', currency: 'USD', invoice_date: '2026-09-15',
  line_items: [
    { description: 'Consulting', quantity: 10, unit_price: 150, amount: 1500 },
    { description: 'Travel', quantity: 1, unit_price: 250.1, amount: 250.1 },
  ],
  totals: { subtotal: 1750.5, tax_rate: 0, tax: 0, total: 1750.5 },
}

/** A $2.00 subtotal gap on the same invoice — above 0.05% ($0.875): a real FAIL, not rounding. */
export const roundingTooBig: Json = {
  ...roundingDrift, invoice_number: 'INV-RND-2',
  line_items: [
    { description: 'Consulting', quantity: 10, unit_price: 150, amount: 1500 },
    { description: 'Travel', quantity: 1, unit_price: 248.5, amount: 248.5 },
  ],
}

/** No subtotal stated: footing and bottom-line checks must ABSTAIN with FIELD_MISSING naming SUBTOTAL, never guess. */
export const noSubtotal: Json = {
  invoice_number: 'INV-1003', invoice_date: '2026-09-15',
  line_items: [{ description: 'Consulting', quantity: 10, unit_price: 150, amount: 1500 }],
  totals: { tax_rate: 0.0825, tax: 123.75, total: 1623.75 },
}

/** Single-line invoice used with reference documents. 1500 × 0.0825 = 123.75 exactly. */
export const singleLine: Json = {
  invoice_number: 'INV-2001', currency: 'USD', invoice_date: '2026-09-15',
  line_items: [{ description: 'Consulting', quantity: 10, unit_price: 150, amount: 1500 }],
  totals: { subtotal: 1500, tax_rate: 0.0825, tax: 123.75, total: 1623.75 },
}

/** Contract that the single-line invoice satisfies: rate 150, cap 5000, term covers 2026-09-15. */
export const contractOk: Json = {
  rates: [{ rate: 150 }],
  max_amount: 5000,
  effective_date: '2026-01-01',
  expiration_date: '2026-12-31',
}

/** Same contract with a lower rate: RATE_SUP must FAIL with variance = (150 − 140) × qty 10 = 100. */
export const contractOverRate: Json = { ...contractOk, rates: [{ rate: 140 }] }

/** Two candidate rates and no rule names: nothing can match a line to a rate, so RATE_SUP must ABSTAIN — never silently use the first. */
export const contractMultiRate: Json = { ...contractOk, rates: [{ rate: 150 }, { rate: 200 }] }

/** Named rules: the keyword/category matcher correlates each line to its rule, so per-line rate checks run. */
export const contractWithRules: Json = {
  financial_rules: [
    { rule_name: 'Consulting', values: { rate: 150 } },
    { rule_name: 'Crane', values: { rate: 900 } },
  ],
  max_amount: 5000,
  effective_date: '2026-01-01',
  expiration_date: '2026-12-31',
}

/** A crane line billed at 950 against the Crane rule's 900: RATE_SUP must FAIL with variance (950 − 900) × 2 = 100. */
export const craneLine: Json = {
  invoice_number: 'INV-3001', currency: 'USD', invoice_date: '2026-09-15',
  line_items: [{ description: 'Crane rental', quantity: 2, unit_price: 950, amount: 1900 }],
  totals: { subtotal: 1900, tax_rate: 0, tax: 0, total: 1900 },
}

/** Invoice dated outside the contract term: TIME_ORD must FAIL. */
export const singleLineOutOfTerm: Json = { ...singleLine, invoice_date: '2027-02-01' }

/** Delivery evidence agreeing with the single-line invoice: QTY_MATCH must PASS. */
export const evidenceOk: Json = {
  line_items: [{ description: 'Consulting', quantity: 10 }],
  totals: { total: 1500 },
  date: '2026-09-15',
}

/** Delivery evidence showing fewer units than billed: QTY_MATCH must FAIL with variance 2. */
export const evidenceShort: Json = { ...evidenceOk, line_items: [{ description: 'Consulting', quantity: 8 }] }

/** Prior history contains this invoice's exact number (INV-2001): DUP_PROHIB must FAIL (exact duplicate). */
export const withPriorIds: Json = { ...singleLine, prior_invoice_ids: ['INV-1900', 'INV-2001'] }
/** Prior history supplied and empty: no duplicate possible → DUP_PROHIB and DUP_NEAR both PASS. */
export const withNoPriorIds: Json = { ...singleLine, prior_invoice_ids: [] }
/** History with a formatting variant of the number (INV-002001 vs INV-2001): DUP_PROHIB PASS (not exact), DUP_NEAR FAIL (formatting). */
export const nearDupFormatting: Json = { ...singleLine, prior_invoice_ids: ['INV-1900', 'INV-002001'] }
/** History with a revision suffix (INV-2001-A): DUP_PROHIB PASS, DUP_NEAR FAIL (revision — possible re-issue, review). */
export const nearDupRevision: Json = { ...singleLine, prior_invoice_ids: ['INV-2001-A'] }
/** History with only unrelated numbers: DUP_PROHIB and DUP_NEAR both PASS. */
export const noNearDup: Json = { ...singleLine, prior_invoice_ids: ['INV-1900', 'INV-1999'] }

/**
 * The line amount is under an unrecognized name (`charge`), so it can only be found by fuzzy alias search
 * (confidence 75) — and the engine's alias table also lets "amount" reach `totals.total`. Whatever it grabs,
 * a verdict must NEVER be issued on it: MATH_INT and SUM_INT must abstain with AMBIGUOUS_FIELD.
 * Exact fields (subtotal, tax, total) still verify normally.
 */
export const fuzzyLine: Json = {
  invoice_number: 'INV-FZ-1',
  line_items: [{ description: 'Thing', quantity: 10, unit_price: 150, charge: 1500 }],
  totals: { subtotal: 1500, tax_rate: 0, tax: 0, total: 1500 },
}

/**
 * The unit price is under an unrecognized name (`cost`) — found only by fuzzy alias search (75). The amount and
 * quantity are exact. The bridge computes VERIFIED_AMOUNT = rate × qty from the fuzzy rate; that computed value
 * must inherit the rate's low confidence (never 100), and MATH_INT must abstain with AMBIGUOUS_FIELD.
 */
export const fuzzyRate: Json = {
  invoice_number: 'INV-FZ-2',
  line_items: [{ description: 'Thing', quantity: 10, cost: 150, amount: 1500 }],
  totals: { subtotal: 1500, tax_rate: 0, tax: 0, total: 1500 },
}

/** All fixtures that should run without references, for invariant sweeps. */
export const ALL_STANDALONE: Array<[string, Json]> = [
  ['clean', clean],
  ['broken', broken],
  ['eu', eu],
  ['noSubtotal', noSubtotal],
  ['singleLine', singleLine],
  ['withPriorIds', withPriorIds],
  ['withNoPriorIds', withNoPriorIds],
  ['nearDupFormatting', nearDupFormatting],
  ['nearDupRevision', nearDupRevision],
  ['noNearDup', noNearDup],
  ['fuzzyLine', fuzzyLine],
  ['fuzzyRate', fuzzyRate],
]

/** Deterministically reorder every object's keys (reverse), recursively. Arrays keep their order. */
export function reverseKeysDeep<T>(v: T): T {
  if (Array.isArray(v)) return v.map(reverseKeysDeep) as unknown as T
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const src = v as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(src).reverse()) out[k] = reverseKeysDeep(src[k])
    return out as T
  }
  return v
}
