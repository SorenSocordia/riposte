/**
 * The PO balance check (engine 0.6.0, 2026-10-05), shared by the text path (./index.ts) and the
 * structured path (./structured.ts). Engines 0.0.1 to 0.5.0 have no such claim: their verdicts are unchanged.
 *
 * Why. The quantity check compares each bill with what was received, never net of what earlier bills already charged to the
 * same order. An outside controller billed 6 of a PO line with 10 received, paid it, then sent a second bill for 7: the gate
 * approved it, 13 billed against 10 received. A careful clerk nets what is already booked on the order.
 *
 * What it nets. Payment-history rows carry one amount each and no lines, so this check nets AMOUNTS ON THE ORDER, never
 * quantities on a line:
 *
 *   billed to date = Σ amount of every booked row on this order + Σ this bill's line amounts
 *   the order      = Σ over the PO's lines of quantity × unit price (a structured PO line with no quantity: its amount)
 *   billed to date ≤ the order (within the total tolerance)  → PASS
 *   billed to date > the order                                → a person decides (INSUFFICIENT_DATA, AMBIGUOUS_REFERENCE), in
 *                                                              words that name each booked invoice, its amount and the order
 *
 *   A booked row is on this order when its PO number is this order's, compared without case, spaces or punctuation, and its
 *   vendor is not another supplier by the duplicate check's comparison (./duplicate.ts matchVendor: tax id, vendor id, then the
 *   name; a row with no vendor name counts). A row of another order, or of another supplier, is not counted.
 *   This bill counts its lines, not its freight or tax (the PO's prices carry neither). A booked row counts its amount as
 *   booked, which may include tax or freight: a person decides then too, and the words say what was counted.
 *   A credit booked against the order (a negative amount) counts as negative. A booked row under this bill's own invoice
 *   number is not counted: whether it is this bill is the duplicate check's question, and that check holds it or sends it to a
 *   person whenever the vendor is not another supplier, so leaving it out never lets a bill through.
 *
 * What it cannot count, and what then happens (never a silent pass):
 *   - a row of this vendor with no PO number: it may be on this order. It is counted as if it were; the check passes only if
 *     the bill fits even then, and otherwise a person decides, naming the row (FIELD_MISSING). A row that says it was booked
 *     without a purchase order (no_purchase_order: true) is on no order and is not counted.
 *   - a row on this order, or of this vendor with no PO number, that carries no amount, or an amount in another currency:
 *     what it booked is unknown, so a person decides, naming it (FIELD_MISSING), unless what can be counted is already over.
 *   - a PO line with no quantity and no amount, so the order's total is unknown (FIELD_MISSING), or a bill in another currency
 *     than the order (AMBIGUOUS_UNIT): a person decides, but only when something is booked to net.
 *   - nothing booked on the order at all: there is nothing to net. The check passes and says so; the quantity and price checks
 *     hold the bill on its own, as before.
 *
 * It runs only with a payment history: without one, the duplicate check already sends the bill to a person, and what is
 * booked on the order is unknown (listed in not_checked). Deterministic; no I/O.
 */
import type { ClaimVerdict, Evidence, InsufficiencyReason } from '../verdict/schema.js'
import type { RuleRemedies } from '../verdict/remedy.js'
import { matchVendor, type BillVendor, type BookedInvoice } from './duplicate.js'
import { moneyWords } from './words.js'

export const AP_PO_BALANCE_RULE = { id: 'AP_PO_BALANCE', name: 'Billed to date within the purchase order' } as const
const FORMULA = 'Σ booked on this PO (same vendor) + Σ this bill\'s line amounts ≤ Σ PO line quantity × unit price'
const LIST_MAX = 10

/** What the check reads, prepared by each path (evidence in that path's own locators). */
export interface PoBalanceInput {
  /** the order's own number (the purchase order document's) */
  po_number: string
  /** this bill's invoice number: a booked row under the same number is the duplicate check's question, not counted here */
  invoice_number: string | null
  /** each PO line's value: quantity × unit price, or null with the pointer of what is missing */
  order_lines: readonly { total: number | null; missing?: string }[]
  order_currency: string | null
  order_evidence: readonly Evidence[]
  /** this bill's line amounts */
  bill_amounts: readonly number[]
  bill_currency: string | null
  bill_evidence: readonly Evidence[]
  history: readonly BookedInvoice[]
  /** the currency a booked row's amount names, when it names one */
  historyCurrency?: (i: number) => string | null
  historyEvidence: (i: number) => Evidence
  /** where booked row i's field lives, for `missing` (a JSON Pointer or `history[i].po_number`) */
  historyPointer: (i: number, field: 'po_number' | 'amount') => string
  vendor: BillVendor
  /** the currency's minor-unit digits: how money is written in the words */
  minor_digits: number
  tolerance: number
}

/** The not_checked line for a run without payment history (engine 0.6.0). */
export const PO_BALANCE_NOT_RUN = 'PO balance check: no payment history supplied, so what earlier bills already charged to this order is not known'

/**
 * The booked invoices on this order, as the balance check counts them (2026-10-05): same order by number
 * (case, spaces and punctuation aside), not another supplier, not this bill's own number. Each carries an amount and no
 * lines, so a bill's quantities are never netted per line against them.
 */
export function bookedOnOrder(x: { po_number: string; invoice_number: string | null; history: readonly BookedInvoice[]; vendor: BillVendor }): string[] {
  const mine = key(x.po_number)
  const self = x.invoice_number?.trim().toUpperCase() ?? null
  return x.history.filter((h) => !(self !== null && h.invoice_number.trim().toUpperCase() === self) && h.po_number !== undefined && h.po_number.trim() !== '' &&
    key(h.po_number) === mine && matchVendor(x.vendor, h).match !== 'different').map((h) => h.invoice_number)
}

/**
 * The not_checked line naming the per-line netting gap whenever an earlier bill is booked on this order (2026-10-05:
 * the gap applied to the controller's partial-delivery bill, and its output did not say so). Null when none is booked.
 */
export function perLineGapNote(po: string, booked: readonly string[]): string | null {
  if (!booked.length) return null
  const list = `${booked.slice(0, LIST_MAX).join(', ')}${booked.length > LIST_MAX ? `, and ${booked.length - LIST_MAX} more` : ''}`
  const one = booked.length === 1
  return `quantities per PO line across bills: ${one ? 'booked invoice' : 'booked invoices'} ${list} on ${po} ${one ? 'carries' : 'carry'} an amount, not lines, so this bill's quantities were compared with what was received, not netted against what ${one ? 'that bill' : 'those bills'} already billed on each line (the PO balance check nets amounts on the order only)`
}

const r6 = (x: number): number => Math.round(x * 1e6) / 1e6
const key = (s: string): string => {
  const k = s.normalize('NFKC').toUpperCase().replace(/[^\p{L}\p{N}]/gu, '')
  return k === '' ? s.trim().toUpperCase() : k
}

/** The claim. */
export function poBalanceClaim(x: PoBalanceInput): ClaimVerdict {
  const M = (n: number): string => moneyWords(n, x.minor_digits)
  const po = x.po_number
  const mine = key(po)
  const counted: { i: number; amount: number }[] = []
  const unplaced: { i: number; amount: number }[] = []
  const unbounded: { i: number; why: string; missing: string }[] = []
  const self = x.invoice_number?.trim().toUpperCase() ?? null
  x.history.forEach((h, i) => {
    if (self !== null && h.invoice_number.trim().toUpperCase() === self) return
    if (h.no_purchase_order === true && (h.po_number === undefined || h.po_number.trim() === '')) return // booked without a PO: on no order
    if (matchVendor(x.vendor, h).match === 'different') return
    const onPo = h.po_number !== undefined && h.po_number.trim() !== ''
    if (onPo && key(h.po_number!) !== mine) return
    const cur = x.historyCurrency?.(i) ?? null
    const n = h.invoice_number
    if (h.total === undefined) {
      unbounded.push({ i, why: onPo ? `booked invoice ${n} on ${po} carries no amount` : `booked invoice ${n} carries no PO number and no amount`, missing: x.historyPointer(i, 'amount') })
      return
    }
    if (cur !== null && x.order_currency !== null && cur !== x.order_currency) {
      unbounded.push({ i, why: `booked invoice ${n}${onPo ? ` on ${po}` : ''} is in ${cur} and the order in ${x.order_currency}`, missing: x.historyPointer(i, 'amount') })
      return
    }
    ;(onPo ? counted : unplaced).push({ i, amount: h.total })
  })

  const thisBill = r6(x.bill_amounts.reduce((s, a) => s + a, 0))
  const booked = r6(counted.reduce((s, r) => s + r.amount, 0))
  const known = r6(booked + thisBill)
  const listOf = (rows: readonly { i: number; amount: number }[], always = false): string => {
    const shown = rows.slice(0, LIST_MAX).map((r) => (rows.length === 1 && !always ? x.history[r.i]!.invoice_number : `${x.history[r.i]!.invoice_number} ${M(r.amount)}`))
    return `${shown.join(', ')}${rows.length > LIST_MAX ? `, and ${rows.length - LIST_MAX} more` : ''}`
  }
  const evidence: Evidence[] = [...x.bill_evidence, ...x.order_evidence,
    ...[...counted, ...unplaced, ...unbounded].sort((a, b) => a.i - b.i).map((r) => x.historyEvidence(r.i))]
  const base = { claim_id: 'ap.po_balance', kind: 'CROSS_REFERENCE' as const, tier: 'DETERMINISTIC' as const, field: 'po_balance', rule_id: AP_PO_BALANCE_RULE.id, rule_name: AP_PO_BALANCE_RULE.name }

  // nothing booked on the order: nothing to net (the quantity and price checks hold the bill on its own)
  if (!counted.length && !unplaced.length && !unbounded.length) {
    const explanation = x.history.length
      ? `No booked invoice is on ${po} (${x.history.length} booked invoice${x.history.length === 1 ? '' : 's'} compared), so there is nothing to net against this bill.`
      : `The payment history is empty, so nothing is booked on ${po} to net against this bill.`
    return { ...base, outcome: 'PASS', asserted: thisBill,
      computation: { formula: FORMULA, operands: { po, booked: 0, this_bill: thisBill, booked_invoices: 0, history_size: x.history.length }, result: null },
      evidence: [...x.bill_evidence], locked: true, explanation }
  }

  const missingLines = x.order_lines.filter((l) => l.total === null)
  const order = missingLines.length ? null : r6(x.order_lines.reduce((s, l) => s + (l.total as number), 0))
  const operands: Record<string, string | number | null> = { po, booked, this_bill: thisBill, billed_to_date: known, order_total: order, booked_invoices: counted.length,
    ...(unplaced.length ? { no_po_invoices: unplaced.length, no_po_amount: r6(unplaced.reduce((s, r) => s + r.amount, 0)) } : {}),
    ...(unbounded.length ? { uncounted_invoices: unbounded.length } : {}) }
  const computation = { formula: FORMULA, operands, result: order, tolerance: { abs: x.tolerance } }
  const bookedPart = counted.length ? `already booked ${M(booked)} on ${po} (${listOf(counted)})` : `nothing is booked on ${po} by its number`
  const open = (reason: InsufficiencyReason, detail: string, missing?: string[]): ClaimVerdict => ({
    ...base, outcome: 'INSUFFICIENT_DATA', asserted: known, computation, evidence,
    insufficiency: { reason, detail, ...(missing ? { missing } : {}) }, locked: false, explanation: detail,
  })

  if (order === null) {
    return open('FIELD_MISSING', `the order's total is not known (${missingLines.length === 1 ? 'a PO line states' : `${missingLines.length} PO lines state`} no quantity and no amount), so what is booked on ${po} cannot be netted against this bill: ${bookedPart}; this bill ${M(thisBill)}`,
      missingLines.map((l) => l.missing ?? 'purchase_order line quantity'))
  }
  if (x.bill_currency !== null && x.order_currency !== null && x.bill_currency !== x.order_currency) {
    return open('AMBIGUOUS_UNIT', `the bill is in ${x.bill_currency} and the order in ${x.order_currency}, so what is booked on ${po} cannot be netted against this bill`)
  }
  const fits = (n: number): boolean => n <= order + x.tolerance
  const notCounted = [
    ...(unplaced.length ? [`${unplaced.length === 1 ? 'booked invoice' : `${unplaced.length} booked invoices`} from this vendor with no PO number (${listOf(unplaced, true)})`] : []),
    ...unbounded.map((u) => u.why),
  ]

  if (!fits(known)) {
    const also = notCounted.length ? `. Not counted: ${notCounted.join('; ')}` : ''
    return open('AMBIGUOUS_REFERENCE', `billed to date on ${po} would be ${M(known)}, ${M(r6(known - order))} more than the order: ${bookedPart}; this bill ${M(thisBill)}; the order totals ${M(order)}${also}. Booked invoices carry amounts, not lines, so this nets amounts on the order, not quantities on a line: a person confirms what is still open on the order before this bill is paid`)
  }
  if (unbounded.length) {
    return open('FIELD_MISSING', `what is already booked on ${po} cannot all be counted: ${unbounded.map((u) => u.why).join('; ')}. What can be counted comes to ${M(known)} of the order's ${M(order)} (${bookedPart}; this bill ${M(thisBill)})${unplaced.length ? `, before ${notCounted[0]}` : ''}`,
      unbounded.map((u) => u.missing))
  }
  if (unplaced.length) {
    const worst = r6(known + unplaced.reduce((s, r) => s + r.amount, 0))
    if (!fits(worst)) {
      return open('FIELD_MISSING', `${notCounted[0]}: whether ${unplaced.length === 1 ? 'it was' : 'they were'} billed on ${po} is not known. Counted on this order, billed to date would be ${M(worst)}, more than the order's ${M(order)}; without ${unplaced.length === 1 ? 'it' : 'them'}, ${M(known)} (${bookedPart}; this bill ${M(thisBill)})`,
        unplaced.map((r) => x.historyPointer(r.i, 'po_number')))
    }
    return { ...base, outcome: 'PASS', asserted: known, computation, evidence, locked: true,
      explanation: `Billed to date on ${po} is ${M(known)} of the order's ${M(order)}: ${bookedPart}; this bill ${M(thisBill)}. ${notCounted[0]![0]!.toUpperCase()}${notCounted[0]!.slice(1)}: counted as if on this order, billed to date would be ${M(worst)}, which still fits.` }
  }
  return { ...base, outcome: 'PASS', asserted: known, computation, evidence, locked: true,
    explanation: `Billed to date on ${po} is ${M(known)} of the order's ${M(order)}: ${bookedPart}; this bill ${M(thisBill)}.` }
}

/**
 * Remedies for AP_PO_BALANCE (engine 0.6.0's AP table, ./index.ts AP_REMEDIES_V060). Over the order: the buyer, who owns the
 * order, rules; or a change order or a credit makes it a new check. Something it could not count: the missing fields, or a clerk.
 */
export const PO_BALANCE_REMEDIES: RuleRemedies = {
  abstain: [
    { kind: 'authority', authority: 'buyer', when: ['AMBIGUOUS_REFERENCE'],
      detail: 'Billed to date on {op:po} would be {asserted}, more than the order total of {expected}. The buyer confirms what is still open on the order (a change order not yet on the PO, a booked invoice credited or voided, or a booked amount that includes tax or freight), for this verdict only.' },
    { kind: 'missing-operand', operand: { source: 'purchase_order' }, when: ['AMBIGUOUS_REFERENCE'],
      detail: 'A change order raising the total of {op:po}, or a credit booked against an earlier invoice on it: the bill is then checked as a new verdict.' },
    { kind: 'missing-operand', operand: { source: 'history' }, when: ['FIELD_MISSING'],
      detail: 'What the check could not count ({missing}): the PO number and amount of each booked invoice named, or the quantity of each PO line named. Supply it, and the check runs again.' },
    { kind: 'authority', authority: 'ap-clerk', when: ['FIELD_MISSING', 'AMBIGUOUS_UNIT'],
      detail: 'A person confirms which order each booked invoice named here was billed against, and that {op:po} has room for this bill, for this verdict only.' },
  ],
}
