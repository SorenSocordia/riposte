/**
 * AP line recompute (ruleset ap-threeway 0.2.0): an invoice line's stated amount against its own quantity × unit price.
 *
 * THE RULE (pre-registered before any benchmark run under it; docs/AP-LINE-MATH-2026-09-29.md):
 *   P = quantity × unit_price, computed EXACTLY (integer arithmetic on the written decimals, no floating point);
 *   PASS iff |amount − P| ≤ one minor unit of the currency (inclusive).
 * Every way of rounding P to the minor unit (half-up, half-even, half-down, truncation, ceiling) lands within one minor unit,
 * so a correctly rounded amount passes at any unit-price precision and any quantity, whole or fractional. A single minor
 * unit is never a hold; an error of two minor units or more always FAILs. The recomputed amount a person sees is P rounded
 * half-up to the minor unit; the variance on a FAIL is amount − that.
 *
 * The minor unit comes from the currency code on the PO line (ISO 4217: 0 digits for JPY, KRW…, 3 for KWD, BHD…, else 2).
 * It is never inferred from how round the written amounts look: a round number is not a rounded one.
 *
 * NEVER A GUESSED FAIL: a line that does not compute FAILs only when its text shows no adjustment the product does not model
 * (a percent sign, a discount/fee/tax/credit word, a signed amount). Otherwise the check abstains and names the marker.
 *
 * Pure; no imports. The book's verdict door (ledger/decisions.ts) runs apLineMathProblem on a recorded 0.2.0 verdict, so a
 * line FAIL flipped to PASS (with its outcome and coverage rewritten to match) is refused from the claim's own operands.
 */

export const AP_LINE_MATH_RULE = { id: 'AP_LINE_MATH', name: 'Line amount equals quantity × unit price', formula: '|line.amount − quantity × unit_price| ≤ one minor unit' } as const

/** ISO 4217 currencies with no minor unit, and with three decimals. Every other code (and no code) has two. */
const ZERO_DIGIT = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF'])
const THREE_DIGIT = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND'])

/** The currency's minor-unit digits (ISO 4217). 2 when the code is unknown or absent. */
export function minorUnitDigits(code: string | null | undefined): number {
  const c = typeof code === 'string' ? code.toUpperCase() : ''
  return ZERO_DIGIT.has(c) ? 0 : THREE_DIGIT.has(c) ? 3 : 2
}

/** An exact decimal: value = m × 10^-e. */
interface Dec { m: bigint; e: number }

/**
 * The exact decimal a parsed number was written as. A number read from text prints back as the digits it was read from
 * (its shortest round-trip form) whenever it has at most 15 significant digits; more, or an exponent, is not trusted.
 */
function exactDecimal(x: number): Dec | null {
  if (!Number.isFinite(x)) return null
  const t = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(x))
  if (!t) return null
  const frac = t[3] ?? ''
  if ((t[2]! + frac).replace(/^0+/, '').length > 15) return null
  return { m: BigInt(`${t[1]}${t[2]}${frac}`), e: frac.length }
}

const pow10 = (n: number): bigint => 10n ** BigInt(n)
const at = (d: Dec, e: number): bigint => d.m * pow10(e - d.e) // requires e ≥ d.e
const abs = (x: bigint): bigint => (x < 0n ? -x : x)

/** Fixed-point text of m × 10^-e, with at least `min` decimals. */
function text(d: Dec, min = 0): string {
  const e = Math.max(d.e, min)
  const m = at(d, e)
  const neg = m < 0n
  const s = abs(m).toString().padStart(e + 1, '0')
  const out = e ? `${s.slice(0, s.length - e)}.${s.slice(s.length - e)}` : s
  return neg ? `-${out}` : out
}

/** Round half away from zero ("half-up") to `digits` decimals. */
function roundHalfUp(d: Dec, digits: number): Dec {
  if (d.e <= digits) return { m: at(d, digits), e: digits }
  const div = pow10(d.e - digits)
  let q = d.m / div // truncates toward zero
  const r = abs(d.m % div)
  if (r * 2n >= div) q += d.m < 0n ? -1n : 1n
  return { m: q, e: digits }
}

export interface LineMathInput {
  quantity: number | null | undefined
  unit_price: number | null | undefined
  /** the stated line amount */
  amount: number | null | undefined
  /** the currency's minor-unit digits (minorUnitDigits) */
  minor_digits: number
}

export type LineMathResult =
  | {
    ok: true
    outcome: 'PASS' | 'FAIL'
    /** quantity × unit_price, exact, as text (no trailing zeros) */
    exact_product: string
    /** the product rounded half-up to the minor unit */
    recomputed: number
    recomputed_text: string
    /** amount − recomputed, at the minor unit (0 on an exact match) */
    variance: number
    variance_text: string
    /** |amount − exact product| */
    deviation: number
    /** one minor unit */
    tolerance: number
  }
  | { ok: false; reason: 'FIELD_MISSING' | 'UNPARSEABLE'; detail: string }

/** Recompute one line under the rule above. Never throws; a missing or untrustworthy operand is a reason, not a guess. */
export function recomputeLine(x: LineMathInput): LineMathResult {
  const named: [string, number | null | undefined][] = [['quantity', x.quantity], ['unit price', x.unit_price], ['line amount', x.amount]]
  const missing = named.filter(([, v]) => v === null || v === undefined).map(([k]) => k)
  if (missing.length) return { ok: false, reason: 'FIELD_MISSING', detail: `the line has no ${missing.join(' or ')}, so quantity × unit price cannot be recomputed` }
  const dec = named.map(([k, v]) => [k, typeof v === 'number' ? exactDecimal(v) : null] as const)
  const bad = dec.filter(([, d]) => d === null).map(([k]) => k)
  if (bad.length) return { ok: false, reason: 'UNPARSEABLE', detail: `the ${bad.join(' and ')} cannot be read as an exact decimal (more than 15 significant digits, or not a number)` }
  if (!Number.isInteger(x.minor_digits) || x.minor_digits < 0 || x.minor_digits > 4) return { ok: false, reason: 'UNPARSEABLE', detail: `minor-unit digits ${x.minor_digits} is not 0–4` }
  const [q, u, a] = dec.map(([, d]) => d!) as [Dec, Dec, Dec]
  const d = x.minor_digits
  const p: Dec = { m: q.m * u.m, e: q.e + u.e }
  const E = Math.max(a.e, p.e, d)
  const dev = abs(at(a, E) - at(p, E))
  const tol = pow10(E - d)
  const r = roundHalfUp(p, d)
  const ve = Math.max(a.e, d)
  const v: Dec = { m: at(a, ve) - at(r, ve), e: ve }
  return {
    ok: true,
    outcome: dev <= tol ? 'PASS' : 'FAIL',
    exact_product: text(p).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, ''),
    recomputed: Number(text(r)),
    recomputed_text: text(r, d),
    variance: Number(text(v)),
    variance_text: text(v, d),
    deviation: Number(text({ m: dev, e: E })),
    tolerance: Number(text({ m: 1n, e: d })),
  }
}

const ADJUSTMENT_WORD = /\b(?:discount|discounted|rebate|allowance|surcharge|fees?|charges?|deposit|tax|vat|gst|hst|pst|markdown|promo|promotion|coupon|credit|less)\b|\bdisc\./i
/**
 * A signed amount: a minus sign or an opening parenthesis directly before a number (a currency marker may sit between),
 * standing at the line start or after whitespace, `|`, `:`, `=` or `(`. Not a hyphen inside an identifier (PO-49051), and
 * not a list bullet ("- 10 x …": the dash is followed by a space).
 */
const SIGNED_AMOUNT = /(?:^|[\s|:=(])([-−–(](?:(?:USD|EUR|GBP|CAD)\s?|[$€£])?\d[\d,]*(?:\.\d+)?\)?)/i

/** The first adjustment the product does not model, on a raw invoice line, or null: a percent sign, an adjustment word, a signed amount. */
export function adjustmentMarker(line: string): string | null {
  if (line.includes('%')) return '%'
  const w = ADJUSTMENT_WORD.exec(line)
  if (w) return w[0]
  return SIGNED_AMOUNT.exec(line)?.[1] ?? null
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

/**
 * The book's check on an ap-threeway 0.2.0, 0.3.0 or 0.4.0, or ap-structured 0.1.0, verdict (undefined for any other ruleset or version): every line it prices carries
 * a line-amount claim, and every PASS/FAIL line-amount claim recomputes, from its own operands, to its own outcome, result
 * and variance. Catches a line FAIL flipped to PASS, or deleted, with the outcome and coverage rewritten to match.
 * HONEST BOUNDARY: operands rewritten together with the outcome (or a FAIL rewritten as can't-tell) need the documents:
 * replay with the inputs, or a signed envelope.
 */
export function apLineMathProblem(v: unknown): string | undefined {
  if (!isObj(v) || !isObj(v.ruleset) || !Array.isArray(v.claims)) return undefined
  // ap-structured 0.1.0 (2026-10-03) carries the same line recompute under the same claim ids, so it is held to it too.
  // ap-threeway 0.3.0 (2026-10-14) prices its lines the same way (a per-thousand price is read as the price of one unit), so it is held to it too.
  // ap-threeway 0.4.0 (2026-10-19) reads payment sentences and the Reply-To further and prices its lines as 0.3.0 does: held to it too.
  if (!((v.ruleset.id === 'ap-threeway' && (v.ruleset.version === '0.2.0' || v.ruleset.version === '0.3.0' || v.ruleset.version === '0.4.0')) || (v.ruleset.id === 'ap-structured' && v.ruleset.version === '0.1.0'))) return undefined
  const label = `${String(v.ruleset.id)} ${String(v.ruleset.version)}`
  const id = String(v.verdict_id)
  const claims = v.claims.filter(isObj)
  const ids = new Set(claims.map((c) => c.claim_id))
  for (const c of claims) {
    const L = /^ap\.line\[(\d+)\]\.price$/.exec(String(c.claim_id))?.[1]
    if (L !== undefined && !ids.has(`ap.line[${L}].amount`)) return `verdict ${id}: an ${label} verdict recomputes every line it prices, and claim ap.line[${L}].amount is missing`
  }
  for (const c of claims) {
    if (!/^ap\.line\[\d+\]\.amount$/.test(String(c.claim_id)) || (c.outcome !== 'PASS' && c.outcome !== 'FAIL')) continue
    const where = `verdict ${id}: claim ${String(c.claim_id)}`
    if (c.rule_id !== AP_LINE_MATH_RULE.id) return `${where} is not rule ${AP_LINE_MATH_RULE.id}`
    const comp = isObj(c.computation) ? c.computation : undefined
    const ops = comp && isObj(comp.operands) ? comp.operands : undefined
    if (!comp || !ops) return `${where} carries no computation to recompute`
    const currency = typeof ops.currency === 'string' ? ops.currency : null
    if (ops.minor_unit_digits !== minorUnitDigits(currency)) return `${where}: minor_unit_digits ${String(ops.minor_unit_digits)} is not the minor unit of ${currency ?? 'an unstated currency'} (${minorUnitDigits(currency)})`
    const num = (x: unknown): number | null => (typeof x === 'number' ? x : null)
    const m = recomputeLine({ quantity: num(ops.quantity), unit_price: num(ops.unit_price), amount: num(c.asserted), minor_digits: minorUnitDigits(currency) })
    if (!m.ok) return `${where} cannot be recomputed from its own operands (${m.detail})`
    if (m.outcome !== c.outcome) return `${where} is ${String(c.outcome)}, but its own operands recompute to ${m.outcome}: ${String(ops.quantity)} × ${String(ops.unit_price)} = ${m.exact_product} against ${String(c.asserted)} (within one minor unit: ${m.outcome === 'PASS' ? 'yes' : 'no'})`
    if (comp.result !== m.recomputed || ops.exact_product !== m.exact_product) return `${where}: its computation does not recompute (result ${String(comp.result)}, exact product ${String(ops.exact_product)}; recomputed ${m.recomputed}, ${m.exact_product})`
    if (c.outcome === 'FAIL' && c.variance !== m.variance) return `${where}: variance ${String(c.variance)} does not recompute (${m.variance})`
  }
  return undefined
}
