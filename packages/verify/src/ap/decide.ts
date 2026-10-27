/**
 * The AP policy decision, shared by the text path (./index.ts, ap-threeway) and the structured path (./structured.ts,
 * ap-structured): the checks in order, stop at the first failure, ABSTAIN — never guess — when a check it would need before
 * the first failure could not be decided. One function, so both paths decide the same way on the same claims.
 *
 * Order: duplicate (only with history) · PO number · every line's quantity · every line's price · every line's amount
 * (line recompute rulesets) · total · payment details, vendor, tax, billed to date per line (engine 0.6.0, when they ran) ·
 * PO balance (engine 0.6.0, only with history; ./po-balance.ts). The PO balance check
 * never FAILs: over the order it is a person's decision, and last, so a hold on any other check is the label. A "line" is a claim-id prefix such as `ap.line[2]` (a PO line) or, structured only,
 * `ap.bill_line[3]` (a bill line that matches no PO line).
 *
 * Engine 0.6.0 adds a last step (ApDecisionContext.failClosed): an approve stands only on a verdict that reads exactly PASS,
 * so the decision and the verdict's gate_status never disagree, whichever door the bill came through.
 */
import type { ClaimVerdict, Coverage, Verdict } from '../verdict/schema.js'
import type { ApDecision, ApResult } from './index.js'

export interface ApDecisionContext {
  verdict: Verdict
  claims: readonly ClaimVerdict[]
  coverage: Coverage
  /** history was supplied (the duplicate check runs first) */
  history: boolean
  /** the ruleset recomputes each line's amount */
  lineMath: boolean
  /** claim-id prefixes of the lines, in order, each with the item name a clerk sees */
  lines: readonly { prefix: string; name: string | null }[]
  invoice_number: string | null
  po_number: string | null
  not_checked: string[]
  /** the approve reason (what "all checks passed" means for this ruleset) */
  approveReason: string
  /** Engine 0.6.0 (2026-10-05): the PO balance check ran (ap.po_balance), last in order. Absent: not in order. */
  poBalance?: boolean
  /**
   * Engine 0.6.0 (2026-10-05): the vendor check ran (ap.vendor; ./vendor.ts), after the total. It never FAILs:
   * a bill whose vendor is not the order's goes to a person. Absent (a purchase order that names no vendor): not in order.
   */
  vendor?: boolean
  /**
   * Engine 0.6.0 (2026-10-05): the tax check ran (ap.tax; ./tax.ts, structured input that carries tax), after
   * the vendor check. A FAIL (tax on an order that states a rate of 0) is hold_total; anything else open goes to a person.
   */
  tax?: boolean
  /**
   * Engine 0.6.0 (2026-10-06): the payment-details check ran (ap.remittance; ./remittance.ts, a text bill
   * whose text asks to change where payment goes or prints bank-account details), after the total and before the vendor check.
   * It never FAILs: the bill goes to a person, the controller clears it.
   */
  remittance?: boolean
  /**
   * Engine 0.6.0 (2026-10-06): the billed-to-date checks that ran (`ap.line[L].billed_to_date`; ./qty-to-date.ts,
   * structured input whose PO line carries invoiced_quantity_to_date), after the tax check. They never FAIL: over what was
   * received, the bill goes to a person.
   */
  billedToDate?: readonly string[]
  /**
   * Engine 0.6.0 (2026-10-06): what an approve did not check for this bill (the vendor's identity beyond the
   * match, the bank details, tax), appended to not_checked on an approve only, so every approve prints its scope.
   */
  approveScope?: readonly string[]
  /**
   * Engine 0.7.0 (2026-10-13): facts an approve states after its reason, such as a partial bill ("partial: 1 of 2
   * purchase-order lines billed; 1 line open"). Appended to the reasons of an approve only.
   */
  approveNotes?: readonly string[]
  /**
   * Engine 0.6.0 (2026-10-05): a check that did not run and that the reader must see, such as the duplicate check without
   * payment history. It is the FIRST reason of an approve (an approve without it would read as a bare approve) and the last
   * reason of a hold or an abstain (the hold's own reason stays first). Absent under earlier engines: reasons unchanged.
   */
  openReason?: string
  /**
   * Engine 0.6.0 (2026-10-05): fail closed, one answer per bill. Set by both paths under engine 0.6.0; absent
   * under earlier engines, whose decisions and reasons are unchanged.
   *  - An approve needs a verdict that reads exactly PASS. A verdict that reads PASS_WITH_OPEN (a check could not run, above
   *    all the duplicate check without payment history) is decided by a person: decision 'abstain', payable false, and the
   *    first reason names the open check ("cannot decide ap.duplicate: ..."), the duplicate check before any other.
   *  - Every abstain is payable false, never null: nothing is paid without a person. payable is true exactly on an approve.
   *  - An approve says what the duplicate check found: the invoice number booked under another vendor (with what that booked
   *    row carries), or an empty payment history; never a bare "including the duplicate check" in those cases.
   */
  failClosed?: boolean
}

export function apPolicyDecision(x: ApDecisionContext): ApResult {
  const r = decideInOrder(x)
  if (!x.failClosed) return withOpenReason(r, x.openReason)
  if (r.decision === 'approve') {
    const failed = x.claims.filter((c) => c.outcome === 'FAIL')
    const open = x.claims.filter((c) => c.outcome === 'INSUFFICIENT_DATA')
    const status = x.verdict.gate_status ?? (failed.length ? 'FAIL' : open.length ? 'PASS_WITH_OPEN' : 'PASS')
    if (status !== 'PASS' || failed.length || open.length) return aPersonDecides(r, x, failed, open)
    // 2026-10-06: every approve says what it did not check for this bill
    return { ...r, reasons: [...approveReasons(x), ...(x.approveNotes ?? [])], not_checked: [...r.not_checked, ...(x.approveScope ?? []).filter((s) => !r.not_checked.includes(s))] }
  }
  const out = withAlsoOpen(withOpenReason(r, x.openReason), x)
  return out.decision === 'abstain' ? { ...out, payable: false } : out
}

/**
 * Engine 0.6.0 (2026-10-05): a hold, or a person's decision on another check, also names an open vendor or tax
 * check, so a person clearing the hold sees that the bill's vendor is not the order's (or its tax is not settled). The hold's
 * own reason stays first, and its label and grounding are unchanged.
 */
function withAlsoOpen(r: ApResult, x: ApDecisionContext): ApResult {
  // 2026-10-06: the payment-details check and the billed-to-date checks are named on a hold too
  const ids = [...(x.remittance ? ['ap.remittance'] : []), ...(x.vendor ? ['ap.vendor'] : []), ...(x.tax ? ['ap.tax'] : []), ...(x.billedToDate ?? [])]
  const extra = ids.flatMap((id) => {
    const c = x.claims.find((k) => k.claim_id === id)
    if (!c || c.outcome !== 'INSUFFICIENT_DATA' || r.reasons.some((s) => s.startsWith(`cannot decide ${id}:`))) return []
    return [`also for a person: cannot decide ${id}: ${c.insufficiency?.detail ?? c.explanation}`]
  })
  return extra.length ? { ...r, reasons: [...r.reasons, ...extra] } : r
}

/**
 * True when a result abstains ONLY because no payment history was supplied: nothing failed, and the one check that could not
 * run is the duplicate check, for want of a history (claim ap.duplicate, reason REFERENCE_NOT_PROVIDED). Every check that ran
 * passed. False for every other abstain (a look-alike vendor is a hold, never an abstain; an ambiguous duplicate, a line with
 * no receipt, an unreadable field or a currency mismatch is a person's decision for its own reason), for holds, and for an
 * approve. For a caller that has chosen to accept bills whose duplicate check did not run; the decision itself stays abstain.
 */
export function abstainsOnlyForMissingHistory(r: Pick<ApResult, 'decision' | 'verdict'>): boolean {
  if (r.decision !== 'abstain') return false
  const claims = r.verdict.claims
  if (claims.some((c) => c.outcome === 'FAIL')) return false
  const open = claims.filter((c) => c.outcome !== 'PASS')
  return open.length === 1 && open[0]!.claim_id === 'ap.duplicate' && open[0]!.insufficiency?.reason === 'REFERENCE_NOT_PROVIDED'
}

/** The reason of a check that did not run, stated where the reader sees it (see ApDecisionContext.openReason). */
function withOpenReason(r: ApResult, openReason: string | undefined): ApResult {
  if (openReason === undefined) return r
  return { ...r, reasons: r.decision === 'approve' ? [openReason, ...r.reasons] : [...r.reasons, openReason] }
}

/** Engine 0.6.0: an approve over a verdict that does not read exactly PASS goes to a person, the open check named first. */
function aPersonDecides(r: ApResult, x: ApDecisionContext, failed: readonly ClaimVerdict[], open: readonly ClaimVerdict[]): ApResult {
  const ordered = [...open.filter((c) => c.claim_id === 'ap.duplicate'), ...open.filter((c) => c.claim_id !== 'ap.duplicate')]
  const reasons = [
    ...ordered.map((c) => `cannot decide ${c.claim_id}: ${c.insufficiency?.detail ?? c.explanation}`),
    ...failed.map((c) => `${c.claim_id} failed: ${c.explanation}`),
    // no counts here: a reason carries only facts a letter may quote (the counts are the verdict's coverage)
    failed.length ? 'a person decides before this bill is paid' : 'every check that ran passed; a person decides before this bill is paid',
  ]
  return { ...r, decision: 'abstain', payable: false, reasons }
}

/** Engine 0.6.0: the approve's reasons, saying what the duplicate check found when that is more than "not booked". */
function approveReasons(x: ApDecisionContext): string[] {
  const dup = x.claims.find((c) => c.claim_id === 'ap.duplicate')
  const ops = dup?.outcome === 'PASS' ? dup.computation?.operands ?? {} : {}
  if (typeof ops.same_number_other_vendor === 'number' && ops.same_number_other_vendor > 0) return [dup!.explanation, 'every check passed']
  // 2026-10-06: a possible resubmission settled by the purchase order's billed-to-date figures is said, with the quantities
  if (ops.resubmission_settled_by !== undefined) return [dup!.explanation, 'every check passed']
  if (ops.history_size === 0) return ['all checks passed; the payment history supplied is empty, so the duplicate check had no booked invoice to compare']
  return [x.approveReason]
}

function decideInOrder(x: ApDecisionContext): ApResult {
  const { verdict, coverage, invoice_number, po_number, not_checked } = x
  // a null label: a check that never FAILs (the PO balance check); were it to, the bill goes to a person
  const order: [string, Exclude<ApDecision, 'approve' | 'abstain'> | null][] = [
    ...(x.history ? [['ap.duplicate', 'hold_duplicate'] as [string, 'hold_duplicate']] : []),
    ['ap.po_number', 'hold_no_po'],
    ...x.lines.map((l) => [`${l.prefix}.quantity`, 'hold_quantity'] as [string, 'hold_quantity']),
    ...x.lines.map((l) => [`${l.prefix}.price`, 'hold_price'] as [string, 'hold_price']),
    ...(x.lineMath ? x.lines.map((l) => [`${l.prefix}.amount`, 'hold_line_math'] as [string, 'hold_line_math']) : []),
    ['ap.total', 'hold_total'],
    // engine 0.6.0: the vendor check (never FAILs) and the tax check (a stated-zero rate holds as hold_total), after
    // every check that holds on arithmetic, so a hold there stays the label (withAlsoOpen names an open vendor or tax check)
    // 2026-10-06: the payment-details check (never FAILs) leads the person's checks, and the billed-to-date checks follow tax
    ...(x.remittance ? [['ap.remittance', null] as [string, null]] : []),
    ...(x.vendor ? [['ap.vendor', null] as [string, null]] : []),
    ...(x.tax ? [['ap.tax', 'hold_total'] as [string, 'hold_total']] : []),
    ...(x.billedToDate ?? []).map((id) => [id, null] as [string, null]),
    ...(x.poBalance ? [['ap.po_balance', null] as [string, null]] : []),
  ]
  const nameOf = new Map<string, string | null>()
  for (const l of x.lines) if (!nameOf.has(l.prefix)) nameOf.set(l.prefix, l.name)
  const byId = new Map(x.claims.map((c) => [c.claim_id, c]))
  for (const [id, label] of order) {
    const c = byId.get(id)
    if (!c || c.outcome === 'INSUFFICIENT_DATA') {
      return { verdict, decision: 'abstain', payable: coverage.claims_fail > 0 ? false : null,
        grounding: { invoice_number, po_number, item: null, invoiced: null, expected: null },
        reasons: [`cannot decide ${id}: ${c?.insufficiency?.detail ?? 'check missing'}`, ...(coverage.claims_fail > 0 ? ['a later check FAILED — do not pay, but the policy label is undetermined'] : [])],
        not_checked }
    }
    if (c.outcome === 'FAIL' && label === null) {
      return { verdict, decision: 'abstain', payable: false, grounding: { invoice_number, po_number, item: null, invoiced: null, expected: null }, reasons: [`cannot decide ${id}: ${c.explanation}`], not_checked }
    }
    if (c.outcome === 'FAIL' && label !== null) {
      const prefix = id.slice(0, id.lastIndexOf('.'))
      const item = nameOf.get(prefix) ?? null
      const ops = c.computation?.operands ?? {}
      const grounding = label === 'hold_duplicate'
        ? { invoice_number, po_number, item: null, invoiced: invoice_number, expected: (ops.booked_as as string) ?? null }
        : label === 'hold_no_po'
          ? { invoice_number, po_number, item: null, invoiced: (ops.invoice_po as string | null) ?? null, expected: (ops.po as string) ?? null }
          : label === 'hold_total'
            ? { invoice_number, po_number, item: null, invoiced: c.asserted as number, expected: c.computation?.result as number }
            : { invoice_number, po_number, item, invoiced: c.asserted as number,
              expected: (label === 'hold_quantity' ? ops.received : label === 'hold_line_math' ? c.computation?.result : ops.po_unit) as number }
      if (invoice_number === null) return { verdict, decision: 'abstain', payable: false, grounding, reasons: [c.explanation, 'invoice number unclear — do not pay, route for identification'], not_checked }
      return { verdict, decision: label, payable: false, grounding, reasons: [c.explanation], not_checked }
    }
  }
  if (invoice_number === null) return { verdict, decision: 'abstain', payable: null, grounding: { invoice_number, po_number, item: null, invoiced: null, expected: null }, reasons: ['all checks passed but the invoice number is unclear'], not_checked }
  return { verdict, decision: 'approve', payable: true, grounding: { invoice_number, po_number, item: null, invoiced: null, expected: null }, reasons: [x.approveReason], not_checked }
}
