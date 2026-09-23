/**
 * AP three-way match — invoice ↔ purchase order ↔ goods receipt, as verify's standard proof object.
 *
 * Every check is its own claim (PASS / FAIL / INSUFFICIENT_DATA, with evidence spans into the document it read):
 *   ap.duplicate            CROSS_REFERENCE  (only if payment history is supplied) invoice not already booked — exact
 *                                            repeat FAILs (hold_duplicate); same vendor + PO + total under a new number
 *                                            ABSTAINS for a person to confirm; without history it is listed in not_checked
 *   ap.po_number            CROSS_REFERENCE  invoice's PO number === the PO's number
 *   ap.line[L].quantity     CROSS_REFERENCE  invoiced units ≤ units received (goods receipt)
 *   ap.line[L].price        CROSS_REFERENCE  invoiced unit price ≤ PO unit price × (1 + price_tolerance)
 *   ap.total                RECOMPUTE        stated total === Σ line amounts (+ freight only if the PO allows it)
 * The document outcome is verify's ANY_FAIL_FAILS aggregation. On top of it, the POLICY DECISION applies the checks in
 * order and stops at the first failure (approve | hold_no_po | hold_quantity | hold_price | hold_total), and ABSTAINS —
 * never guesses — when a check it would need before the first failure could not be decided.
 *
 * Benchmark (public, Apache-2.0 data; see docs/BENCHMARK-AP.md): blind run 82/100 decided, 0 wrong;
 * with the two disclosed wording rules included here, 100/100, 0 wrong. Synthetic invoices — real ones will abstain more.
 *
 * Deterministic; no I/O; no clock except issued_at.
 */
import { hashOf, sha256 } from '../verdict/canonical.js'
import type { ClaimVerdict, Coverage, Evidence, Outcome, Verdict } from '../verdict/schema.js'
import { ENGINE_VERSION, SCHEMA_VERSION } from '../version.js'
import { close, matchLines, parseGoodsReceipt, parseInvoice, parsePurchaseOrder, round2, type Span } from './parse.js'

export const AP_RULESET = { id: 'ap-threeway', version: '0.1.0', domain: 'accounts-payable' } as const

export type ApDecision = 'approve' | 'hold_duplicate' | 'hold_no_po' | 'hold_quantity' | 'hold_price' | 'hold_total' | 'abstain'

/** An invoice already in the payer's books (from the ERP / payment history). */
export interface PriorInvoice { invoice_number: string; po_number?: string; total?: number; vendor?: string; paid_on?: string }

export interface ApDocuments {
  /** the invoice as received (email body / text) */
  invoice: string
  /** the ERP purchase order, as text ("PO-123 | Vendor: … | Freight: …" + numbered lines) */
  purchase_order: string
  /** the ERP goods receipt, as text (numbered lines "… | received N") */
  goods_receipt: string
  /** OPTIONAL: invoices already booked/paid. Enables the duplicate check (the most common real AP loss). */
  history?: PriorInvoice[]
}

export interface ApPolicy {
  /** max fractional overcharge on unit price before hold_price. Default 0.02 (2%). */
  price_tolerance?: number
  /** total comparison tolerance in currency units. Default 0.005. */
  total_tolerance?: number
}

export interface ApResult {
  verdict: Verdict
  decision: ApDecision
  /** false = do not pay; true = all checks passed; null = abstained (a human must look) */
  payable: boolean | null
  /** the six-field answer a clerk acts on (null fields where not applicable) */
  grounding: { invoice_number: string | null; po_number: string | null; item: string | null; invoiced: string | number | null; expected: string | number | null }
  reasons: string[]
  /** checks that did NOT run, and why — the honest scope of this decision */
  not_checked: string[]
}

export interface VerifyInvoiceMatchOptions { policy?: ApPolicy; producer?: string; now?: () => Date }

/** Split the three-document layout "INVOICE MESSAGE … PURCHASE ORDER (ERP) … GOODS RECEIPT (ERP) …" into its parts. */
export function splitApLayout(text: string): ApDocuments | null {
  const iPo = text.indexOf('PURCHASE ORDER (ERP)')
  const iGr = text.indexOf('GOODS RECEIPT (ERP)')
  if (iPo < 0 || iGr < 0 || iGr < iPo) return null
  return { invoice: text.slice(0, iPo), purchase_order: text.slice(iPo, iGr), goods_receipt: text.slice(iGr) }
}

type Src = 'invoice' | 'purchase_order' | 'goods_receipt'

export function verifyInvoiceMatch(docs: ApDocuments, options: VerifyInvoiceMatchOptions = {}): ApResult {
  const tolP = options.policy?.price_tolerance ?? 0.02
  const tolT = options.policy?.total_tolerance ?? 0.005
  const hashes: Record<Src, string> = { invoice: sha256(docs.invoice), purchase_order: sha256(docs.purchase_order), goods_receipt: sha256(docs.goods_receipt) }
  const ev = (src: Src, span: Span, value: string | number, role: Evidence['role']): Evidence =>
    ({ locator: { kind: 'span', source_hash: hashes[src], start: span.start, end: span.end, line: span.line }, value, confidence: 100, role })

  const inv = parseInvoice(docs.invoice)
  const po = parsePurchaseOrder(docs.purchase_order)
  const gr = parseGoodsReceipt(docs.goods_receipt)
  const claims: ClaimVerdict[] = []
  const insufficient = (claim_id: string, field: string, rule_id: string, rule_name: string, reason: NonNullable<ClaimVerdict['insufficiency']>['reason'], detail: string): ClaimVerdict =>
    ({ claim_id, kind: 'CROSS_REFERENCE', tier: 'DETERMINISTIC', outcome: 'INSUFFICIENT_DATA', field, asserted: null, rule_id, rule_name, evidence: [], insufficiency: { reason, detail }, locked: false, explanation: detail })

  // --- claim: duplicate (only when payment history is supplied) ----------------------------------
  const not_checked: string[] = []
  const vendor = docs.purchase_order.match(/Vendor:\s*([^|\n]+)/)?.[1]?.trim() ?? null
  const sameVendor = (h: PriorInvoice): boolean => !h.vendor || !vendor || h.vendor.trim().toLowerCase() === vendor.toLowerCase()
  const history = docs.history
  if (!history) {
    not_checked.push('duplicate check: no payment history supplied (pass history to enable it)')
  } else if (!inv.invoiceNumber) {
    claims.push(insufficient('ap.duplicate', 'invoice_number', 'AP_DUPLICATE', 'Invoice not already booked', 'UNPARSEABLE', 'invoice number unclear, so the duplicate check cannot run'))
  } else {
    const invNo = inv.invoiceNumber
    const num = invNo.value.toUpperCase()
    const exact = history.findIndex((h) => h.invoice_number.trim().toUpperCase() === num && sameVendor(h))
    const statedTotal = inv.totals.length === 1 ? round2(inv.totals[0]!.value) : null
    const invPo = inv.poNumbers.length === 1 ? inv.poNumbers[0]!.value : null
    const near = exact >= 0 ? -1 : history.findIndex((h) => sameVendor(h) && invPo !== null && h.po_number === invPo &&
      statedTotal !== null && h.total !== undefined && close(round2(h.total), statedTotal, tolT))
    const histEv = (i: number): Evidence => ({ locator: { kind: 'field', source: 'history', path: `history[${i}]` }, value: history[i]!.invoice_number, confidence: 100, role: 'REFERENCE' })
    if (exact >= 0) {
      const h = history[exact]!
      claims.push({ claim_id: 'ap.duplicate', kind: 'CROSS_REFERENCE', tier: 'DETERMINISTIC', outcome: 'FAIL', field: 'invoice_number', asserted: invNo.value,
        rule_id: 'AP_DUPLICATE', rule_name: 'Invoice not already booked',
        computation: { formula: 'invoice_number not in history (same vendor)', operands: { invoice_number: invNo.value, booked_as: h.invoice_number }, result: h.invoice_number },
        evidence: [ev('invoice', invNo.span, invNo.value, 'OPERAND'), histEv(exact)], locked: true,
        explanation: `Invoice ${invNo.value} is already in the books${h.paid_on ? ` (paid ${h.paid_on})` : ''}. Paying it again would be a duplicate payment.` })
    } else if (near >= 0) {
      const h = history[near]!
      claims.push({ ...insufficient('ap.duplicate', 'invoice_number', 'AP_DUPLICATE', 'Invoice not already booked', 'AMBIGUOUS_REFERENCE',
        `possible resubmission: same vendor, same PO (${h.po_number}) and same total (${h.total}) as booked invoice ${h.invoice_number}, under a different number — a person should confirm this is a new delivery`),
        evidence: [histEv(near)] })
    } else {
      claims.push({ claim_id: 'ap.duplicate', kind: 'CROSS_REFERENCE', tier: 'DETERMINISTIC', outcome: 'PASS', field: 'invoice_number', asserted: invNo.value,
        rule_id: 'AP_DUPLICATE', rule_name: 'Invoice not already booked',
        computation: { formula: 'invoice_number not in history (same vendor)', operands: { invoice_number: invNo.value, history_size: history.length }, result: null },
        evidence: [ev('invoice', invNo.span, invNo.value, 'OPERAND'), { locator: { kind: 'field', source: 'history', path: 'history' }, value: history.length, confidence: 100, role: 'CONTEXT' }],
        locked: true, explanation: `Invoice ${invNo.value} does not appear among ${history.length} booked invoice(s).` })
    }
  }

  // --- claim: PO number -------------------------------------------------------------------------
  if (!po.number) {
    claims.push(insufficient('ap.po_number', 'po_number', 'AP_PO_MATCH', 'Invoice references the purchase order', 'UNPARSEABLE', 'the purchase order number could not be read'))
  } else if (inv.poNumbers.length > 1) {
    claims.push(insufficient('ap.po_number', 'po_number', 'AP_PO_MATCH', 'Invoice references the purchase order', 'AMBIGUOUS_FIELD', `the invoice mentions several PO numbers (${inv.poNumbers.map((p) => p.value).join(', ')})`))
  } else if (inv.poNumbers.length === 0) {
    claims.push({ claim_id: 'ap.po_number', kind: 'CROSS_REFERENCE', tier: 'DETERMINISTIC', outcome: 'FAIL', field: 'po_number', asserted: null, rule_id: 'AP_PO_MATCH', rule_name: 'Invoice references the purchase order',
      computation: { formula: 'invoice.po_number = po.number', operands: { invoice_po: null, po: po.number.value }, result: po.number.value },
      evidence: [ev('purchase_order', po.number.span, po.number.value, 'REFERENCE')], locked: true, explanation: `The invoice cites no PO number; the open order is ${po.number.value}.` })
  } else {
    const ip = inv.poNumbers[0]!
    const ok = ip.value === po.number.value
    claims.push({ claim_id: 'ap.po_number', kind: 'CROSS_REFERENCE', tier: 'DETERMINISTIC', outcome: ok ? 'PASS' : 'FAIL', field: 'po_number', asserted: ip.value, rule_id: 'AP_PO_MATCH', rule_name: 'Invoice references the purchase order',
      computation: { formula: 'invoice.po_number = po.number', operands: { invoice_po: ip.value, po: po.number.value }, result: po.number.value },
      evidence: [ev('invoice', ip.span, ip.value, 'OPERAND'), ev('purchase_order', po.number.span, po.number.value, 'REFERENCE')], locked: true,
      explanation: ok ? `Invoice cites ${ip.value}, which is the purchase order.` : `Invoice cites ${ip.value}; the open order is ${po.number.value}.` })
  }

  // --- line matching (needed by quantity + price claims) ------------------------------------------
  let lineProblem: string | null = null
  const byPo = new Map<number, (typeof inv.lines)[number]>()
  if (!po.lines.length) lineProblem = 'the purchase order lines could not be read'
  else if (inv.lines.length !== po.lines.length) lineProblem = `read ${inv.lines.length} invoice line(s) but the PO has ${po.lines.length}`
  else {
    const m = matchLines(inv.lines, po.lines)
    if (!m) lineProblem = 'invoice lines could not be matched to PO lines'
    else if (m.minScore < 0.34) lineProblem = `a line match is too weak to trust (score ${m.minScore.toFixed(2)})`
    else if (m.margin < 0.25) lineProblem = `two different line matchings are nearly as plausible (margin ${m.margin.toFixed(2)})`
    else for (const [i, j] of m.pairs) byPo.set(j, inv.lines[i]!)
  }

  // --- claims: quantity + price per PO line -------------------------------------------------------
  for (let j = 0; j < po.lines.length; j++) {
    const pl = po.lines[j]!
    const L = pl.index
    const il = byPo.get(j)
    const rl = gr.find((r) => r.index === L)
    if (lineProblem || !il) {
      claims.push(insufficient(`ap.line[${L}].quantity`, `line[${L}].quantity`, 'AP_QTY_RECEIVED', 'Billed units were received', 'AMBIGUOUS_REFERENCE', lineProblem ?? `no invoice line matched PO line ${L}`))
      claims.push(insufficient(`ap.line[${L}].price`, `line[${L}].unit_price`, 'AP_PRICE_PO', 'Unit price within PO tolerance', 'AMBIGUOUS_REFERENCE', lineProblem ?? `no invoice line matched PO line ${L}`))
      continue
    }
    if (!rl) {
      claims.push(insufficient(`ap.line[${L}].quantity`, `line[${L}].quantity`, 'AP_QTY_RECEIVED', 'Billed units were received', 'REFERENCE_NOT_PROVIDED', `no goods-receipt line for PO line ${L}`))
    } else {
      const ok = il.qty <= rl.received
      claims.push({ claim_id: `ap.line[${L}].quantity`, kind: 'CROSS_REFERENCE', tier: 'DETERMINISTIC', outcome: ok ? 'PASS' : 'FAIL', field: `line[${L}].quantity`, asserted: il.qty,
        rule_id: 'AP_QTY_RECEIVED', rule_name: 'Billed units were received',
        computation: { formula: 'invoice.qty ≤ receipt.received', operands: { invoiced: il.qty, received: rl.received }, result: rl.received },
        evidence: [ev('invoice', il.span, il.qty, 'OPERAND'), ev('goods_receipt', rl.span, rl.received, 'REFERENCE')], locked: true,
        ...(ok ? {} : { variance: il.qty - rl.received }),
        explanation: `${pl.name}: billed ${il.qty}, received ${rl.received}${ok ? '' : ' — more billed than received'}. (Invoice line "${il.name}".)` })
    }
    const max = pl.unit * (1 + tolP)
    const okP = il.unit <= max + 1e-9
    claims.push({ claim_id: `ap.line[${L}].price`, kind: 'CROSS_REFERENCE', tier: 'DETERMINISTIC', outcome: okP ? 'PASS' : 'FAIL', field: `line[${L}].unit_price`, asserted: il.unit,
      rule_id: 'AP_PRICE_PO', rule_name: 'Unit price within PO tolerance',
      computation: { formula: `invoice.unit ≤ po.unit × ${1 + tolP}`, operands: { invoiced: il.unit, po_unit: pl.unit }, result: round2(max * 10000) / 10000, tolerance: { rel: tolP } },
      evidence: [ev('invoice', il.span, il.unit, 'OPERAND'), ev('purchase_order', pl.span, pl.unit, 'REFERENCE')], locked: true,
      ...(okP ? {} : { variance: round2(il.unit - pl.unit) }),
      explanation: `${pl.name}: invoiced ${il.unit}, PO ${pl.unit} (max ${max.toFixed(4)})${okP ? '' : ' — over tolerance'}.` })
  }

  // --- claim: total -------------------------------------------------------------------------------
  const totalVals = [...new Set(inv.totals.map((t) => round2(t.value)))]
  if (inv.ambiguousTotal) {
    claims.push({ ...insufficient('ap.total', 'total', 'AP_TOTAL_SUM', 'Stated total equals the lines (+ allowed freight)', 'UNPARSEABLE',
      `the total is written with a space inside the number ("${inv.ambiguousTotal.slice(0, 80)}") and no currency marker in front of it — it could be read two ways; not guessing`), kind: 'RECOMPUTE' })
  } else if (totalVals.length !== 1) {
    claims.push({ ...insufficient('ap.total', 'total', 'AP_TOTAL_SUM', 'Stated total equals the lines (+ allowed freight)', totalVals.length ? 'AMBIGUOUS_FIELD' : 'FIELD_MISSING', totalVals.length ? `several different stated totals (${totalVals.join(', ')})` : 'no stated total found'), kind: 'RECOMPUTE' })
  } else if (inv.unclassified.length) {
    const u = inv.unclassified[0]!
    claims.push({ ...insufficient('ap.total', 'total', 'AP_TOTAL_SUM', 'Stated total equals the lines (+ allowed freight)', 'AMBIGUOUS_FIELD',
      `an amount on the invoice (${u.value}, in "${u.text.slice(0, 80)}") is not a line item, the total, freight, or a known stray — cannot tell whether it belongs in the total`), kind: 'RECOMPUTE' })
  } else if (inv.freight.length > 1) {
    claims.push({ ...insufficient('ap.total', 'total', 'AP_TOTAL_SUM', 'Stated total equals the lines (+ allowed freight)', 'AMBIGUOUS_FIELD', 'several freight amounts'), kind: 'RECOMPUTE' })
  } else if (inv.freight.length && po.freightAllowed === null) {
    claims.push({ ...insufficient('ap.total', 'total', 'AP_TOTAL_SUM', 'Stated total equals the lines (+ allowed freight)', 'AMBIGUOUS_UNIT', 'freight billed but the PO does not say whether freight is allowed'), kind: 'RECOMPUTE' })
  } else if (!inv.lines.length) {
    claims.push({ ...insufficient('ap.total', 'total', 'AP_TOTAL_SUM', 'Stated total equals the lines (+ allowed freight)', 'UNPARSEABLE', 'no invoice lines could be read'), kind: 'RECOMPUTE' })
  } else {
    const stated = inv.totals[0]!
    const freight = inv.freight.length && po.freightAllowed ? inv.freight[0]!.value : 0
    const sum = round2(inv.lines.reduce((s, l) => s + l.amount, 0) + freight)
    const ok = close(round2(stated.value), sum, tolT)
    const evidence: Evidence[] = [ev('invoice', stated.span, stated.value, 'OPERAND'), ...inv.lines.map((l) => ev('invoice', l.span, l.amount, 'OPERAND'))]
    if (inv.freight.length) evidence.push(ev('invoice', inv.freight[0]!.span, inv.freight[0]!.value, po.freightAllowed ? 'OPERAND' : 'CONTEXT'))
    claims.push({ claim_id: 'ap.total', kind: 'RECOMPUTE', tier: 'DETERMINISTIC', outcome: ok ? 'PASS' : 'FAIL', field: 'total', asserted: stated.value,
      rule_id: 'AP_TOTAL_SUM', rule_name: 'Stated total equals the lines (+ allowed freight)',
      computation: { formula: 'total = Σ line.amount + (freight if PO allows)', operands: { lines: round2(sum - freight), freight, freight_allowed: po.freightAllowed }, result: sum, tolerance: { abs: tolT } },
      evidence, locked: true, ...(ok ? {} : { variance: round2(stated.value - sum) }),
      explanation: `Stated total ${stated.value}; lines ${round2(sum - freight)}${inv.freight.length ? `, freight ${inv.freight[0]!.value} ${po.freightAllowed ? 'allowed' : 'NOT allowed (excluded)'}` : ''} = ${sum}.${ok ? '' : ' Does not add up.'}` })
  }

  // --- verdict ------------------------------------------------------------------------------------
  const coverage: Coverage = { claims_total: claims.length, claims_checked: 0, claims_pass: 0, claims_fail: 0, claims_insufficient: 0 }
  for (const c of claims) { if (c.outcome === 'PASS') coverage.claims_pass++; else if (c.outcome === 'FAIL') coverage.claims_fail++; else coverage.claims_insufficient++ }
  coverage.claims_checked = coverage.claims_pass + coverage.claims_fail
  // verify's aggregation, unchanged: FAIL if any claim FAILs; else INSUFFICIENT_DATA if nothing could run; else PASS.
  // (The POLICY decision below is stricter: it never approves past an undecided check.)
  const outcome: Outcome = coverage.claims_fail > 0 ? 'FAIL' : coverage.claims_checked === 0 ? 'INSUFFICIENT_DATA' : 'PASS'
  const input_hash = hashOf({ ap: docs, policy: { price_tolerance: tolP, total_tolerance: tolT } })
  const verdict_id = sha256(`${input_hash}:${AP_RULESET.id}@${AP_RULESET.version}:${ENGINE_VERSION}`).slice(0, 32)
  const verdict: Verdict = {
    schema_version: SCHEMA_VERSION, verdict_id, issued_at: (options.now ?? (() => new Date()))().toISOString(), engine_version: ENGINE_VERSION,
    ruleset: { ...AP_RULESET }, input_hash, replayable: true,
    document: { extraction_hash: sha256(docs.invoice), ...(options.producer !== undefined ? { producer: options.producer } : {}), line_items: inv.lines.length },
    references: { contract: true, evidence: 1, history: history?.length ?? 0, source: true },
    outcome, aggregation: 'ANY_FAIL_FAILS', claims, coverage,
  }

  // --- policy decision: checks in order, stop at first failure, abstain if an earlier check is undecided --------------
  const order: [string, Exclude<ApDecision, 'approve' | 'abstain'>][] = [
    ...(history ? [['ap.duplicate', 'hold_duplicate'] as [string, 'hold_duplicate']] : []),
    ['ap.po_number', 'hold_no_po'],
    ...po.lines.map((pl) => [`ap.line[${pl.index}].quantity`, 'hold_quantity'] as [string, 'hold_quantity']),
    ...po.lines.map((pl) => [`ap.line[${pl.index}].price`, 'hold_price'] as [string, 'hold_price']),
    ['ap.total', 'hold_total'],
  ]
  const invoice_number = inv.invoiceNumber?.value ?? null
  const po_number = inv.poNumbers.length === 1 ? inv.poNumbers[0]!.value : null
  const byId = new Map(claims.map((c) => [c.claim_id, c]))
  for (const [id, label] of order) {
    const c = byId.get(id)
    if (!c || c.outcome === 'INSUFFICIENT_DATA') {
      return { verdict, decision: 'abstain', payable: coverage.claims_fail > 0 ? false : null,
        grounding: { invoice_number, po_number, item: null, invoiced: null, expected: null },
        reasons: [`cannot decide ${id}: ${c?.insufficiency?.detail ?? 'check missing'}`, ...(coverage.claims_fail > 0 ? ['a later check FAILED — do not pay, but the policy label is undetermined'] : [])],
        not_checked }
    }
    if (c.outcome === 'FAIL') {
      const L = id.match(/line\[(\d+)\]/)?.[1]
      const pl = L ? po.lines.find((p) => p.index === Number(L)) : undefined
      const ops = c.computation?.operands ?? {}
      const grounding = label === 'hold_duplicate'
        ? { invoice_number, po_number, item: null, invoiced: invoice_number, expected: (ops.booked_as as string) ?? null }
        : label === 'hold_no_po'
          ? { invoice_number, po_number, item: null, invoiced: (ops.invoice_po as string | null) ?? null, expected: (ops.po as string) ?? null }
          : label === 'hold_total'
            ? { invoice_number, po_number, item: null, invoiced: c.asserted as number, expected: c.computation?.result as number }
            : { invoice_number, po_number, item: pl?.name ?? null, invoiced: c.asserted as number, expected: (label === 'hold_quantity' ? ops.received : ops.po_unit) as number }
      if (invoice_number === null) return { verdict, decision: 'abstain', payable: false, grounding, reasons: [c.explanation, 'invoice number unclear — do not pay, route for identification'], not_checked }
      return { verdict, decision: label, payable: false, grounding, reasons: [c.explanation], not_checked }
    }
  }
  if (invoice_number === null) return { verdict, decision: 'abstain', payable: null, grounding: { invoice_number, po_number, item: null, invoiced: null, expected: null }, reasons: ['all checks passed but the invoice number is unclear'], not_checked }
  return { verdict, decision: 'approve', payable: true, grounding: { invoice_number, po_number, item: null, invoiced: null, expected: null }, reasons: [history ? 'all checks passed, including the duplicate check' : 'all four checks passed'], not_checked }
}
