/**
 * AP resolution drafts — the generative half of the AP gate. When the checker holds an invoice it already knows the exact
 * line and both disagreeing values, so it can write what a controller would send: a vendor query, with a short-pay figure
 * where the policy allows one. Every number in the draft is listed in `facts`, with its source (a document, or "computed"
 * from named facts). A test enforces that over every case, so the draft can be sent without re-checking its arithmetic.
 *
 *   hold_quantity  → credit memo for the unreceived units; short-pay the rest
 *   hold_price     → rebill at the PO price; short-pay the overcharge
 *   hold_total     → corrected invoice (no short-pay: we can't tell which line is wrong)
 *   hold_no_po     → confirm the PO (flags a transposed digit when that's what it looks like)
 *   hold_duplicate → do not pay; already booked
 *   approve        → nothing to send
 *   abstain        → nothing drafted: a person reads the reasons (never a guessed letter)
 *
 * Deterministic templates; no model. The draft is a proposal. A person sends it.
 */
import { parseInvoice, splitApLayout, type ApDocuments, type ApResult } from 'riposte-verify'

export interface Fact { label: string; value: number | string; source: 'invoice' | 'purchase_order' | 'goods_receipt' | 'history' | 'computed'; line?: number; from?: string[] }
export interface ResolutionDraft {
  decision: ApResult['decision']
  kind: 'vendor_query' | 'do_not_pay' | 'none' | 'review'
  subject: string
  body: string
  /** payable now / withheld, when the policy lets part of the invoice be paid */
  short_pay?: { payable_now: number; withheld: number; stated_total: number }
  facts: Fact[]
  verdict_id: string
}

const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const qty = (n: number) => String(n)
const r2 = (n: number) => Math.round(n * 100) / 100

/** Two identifiers that differ only by one adjacent swap of characters ("54876" vs "54867"). */
export function isTransposition(a: string, b: string): boolean {
  if (a.length !== b.length || a === b) return false
  const d = [...a].map((ch, i) => (ch !== b[i] ? i : -1)).filter((i) => i >= 0)
  return d.length === 2 && d[1] === d[0]! + 1 && a[d[0]!] === b[d[1]!] && a[d[1]!] === b[d[0]!]
}

/** The invoice line (qty, unit) a failing claim points at, found through the claim's evidence span. */
function invoiceLineFor(check: ApResult, docs: ApDocuments | null, ruleId: string): { qty: number; unit: number; line: number } | null {
  if (!docs) return null
  const claim = check.verdict.claims.find((c) => c.rule_id === ruleId && c.outcome === 'FAIL')
  const loc = claim?.evidence.find((e) => e.role === 'OPERAND')?.locator as { kind?: string; line?: number } | undefined
  if (!loc || loc.kind !== 'span' || typeof loc.line !== 'number') return null
  const l = parseInvoice(docs.invoice).lines.find((x) => x.span.line === loc.line)
  return l ? { qty: l.qty, unit: l.unit, line: loc.line } : null
}

function statedTotal(docs: ApDocuments | null): number | null {
  if (!docs) return null
  const t = [...new Set(parseInvoice(docs.invoice).totals.map((x) => x.value))]
  return t.length === 1 ? t[0]! : null
}

export function draftResolution(check: ApResult, documents?: ApDocuments | string): ResolutionDraft {
  const docs = typeof documents === 'string' ? splitApLayout(documents) : documents ?? null
  const g = check.grounding
  const inv = g.invoice_number ?? 'your invoice'
  const po = g.po_number ?? ''
  const base = { decision: check.decision, verdict_id: check.verdict.verdict_id }
  const facts: Fact[] = []
  const fact = (f: Fact) => { facts.push(f); return f.value }
  if (g.invoice_number) fact({ label: 'invoice number', value: g.invoice_number, source: 'invoice' })
  if (g.item) fact({ label: 'item', value: g.item, source: 'purchase_order' }) // item names carry numbers ("14 oz"); they are facts too

  switch (check.decision) {
    case 'approve':
      return { ...base, kind: 'none', subject: `${inv}: approved`, body: `${inv} matches the purchase order and the goods receipt. Nothing to send.`, facts }
    case 'abstain':
      return { ...base, kind: 'review', subject: `${inv}: needs a person`, body: `No draft: the checker could not read this invoice unambiguously.\n- ${check.reasons.join('\n- ')}`, facts }

    case 'hold_quantity': {
      fact({ label: 'PO number', value: po, source: 'purchase_order' })
      const billed = fact({ label: 'quantity billed', value: g.invoiced as number, source: 'invoice' }) as number
      const received = fact({ label: 'quantity received', value: g.expected as number, source: 'goods_receipt' }) as number
      const excess = fact({ label: 'units billed but not received', value: billed - received, source: 'computed', from: ['quantity billed', 'quantity received'] }) as number
      const line = invoiceLineFor(check, docs, 'AP_QTY_RECEIVED')
      const total = statedTotal(docs)
      let credit = '', short: ResolutionDraft['short_pay']
      if (line) {
        fact({ label: 'invoice unit price', value: line.unit, source: 'invoice', line: line.line })
        const amt = fact({ label: 'credit requested', value: r2(excess * line.unit), source: 'computed', from: ['units billed but not received', 'invoice unit price'] }) as number
        credit = ` That is ${money(amt)} at your invoiced unit price of ${money(line.unit)}.`
        if (total !== null) {
          fact({ label: 'stated total', value: total, source: 'invoice' })
          const now = fact({ label: 'payable now', value: r2(total - amt), source: 'computed', from: ['stated total', 'credit requested'] }) as number
          short = { payable_now: now, withheld: amt, stated_total: total }
        }
      }
      return {
        ...base, kind: 'vendor_query', ...(short ? { short_pay: short } : {}),
        subject: `${inv} (${po}): billed ${qty(billed)} × ${g.item}, received ${qty(received)}`,
        body: `Hello,\n\n${inv} against ${po} bills ${qty(billed)} × ${g.item}, but our goods receipt shows ${qty(received)} received.` +
          ` Please send a credit memo for the ${qty(excess)} unit(s) not delivered, or proof of delivery.${credit}` +
          (short ? `\n\nWe will pay ${money(short.payable_now)} now and hold ${money(short.withheld)} until this is resolved.` : '') + '\n\nThank you.',
        facts,
      }
    }

    case 'hold_price': {
      fact({ label: 'PO number', value: po, source: 'purchase_order' })
      const billed = fact({ label: 'invoiced unit price', value: g.invoiced as number, source: 'invoice' }) as number
      const agreed = fact({ label: 'PO unit price', value: g.expected as number, source: 'purchase_order' }) as number
      const over = fact({ label: 'overcharge per unit', value: r2(billed - agreed), source: 'computed', from: ['invoiced unit price', 'PO unit price'] }) as number
      const pct = fact({ label: 'overcharge %', value: r2(((billed - agreed) / agreed) * 100), source: 'computed', from: ['invoiced unit price', 'PO unit price'] }) as number
      const line = invoiceLineFor(check, docs, 'AP_PRICE_PO')
      const total = statedTotal(docs)
      let short: ResolutionDraft['short_pay'], extra = ''
      if (line) {
        fact({ label: 'quantity on the line', value: line.qty, source: 'invoice', line: line.line })
        const amt = fact({ label: 'overcharge on the line', value: r2(over * line.qty), source: 'computed', from: ['overcharge per unit', 'quantity on the line'] }) as number
        extra = ` Across ${qty(line.qty)} unit(s) that is ${money(amt)}.`
        if (total !== null) {
          fact({ label: 'stated total', value: total, source: 'invoice' })
          const now = fact({ label: 'payable now', value: r2(total - amt), source: 'computed', from: ['stated total', 'overcharge on the line'] }) as number
          short = { payable_now: now, withheld: amt, stated_total: total }
        }
      }
      return {
        ...base, kind: 'vendor_query', ...(short ? { short_pay: short } : {}),
        subject: `${inv} (${po}): ${g.item} billed at ${money(billed)}, PO price ${money(agreed)}`,
        body: `Hello,\n\n${inv} bills ${g.item} at ${money(billed)} per unit; ${po} agreed ${money(agreed)} (${pct}% over, beyond our tolerance).${extra}` +
          ` Please rebill at the PO price, or send the approved price change.` +
          (short ? `\n\nWe will pay ${money(short.payable_now)} now and hold ${money(short.withheld)} until this is resolved.` : '') + '\n\nThank you.',
        facts,
      }
    }

    case 'hold_total': {
      fact({ label: 'PO number', value: po, source: 'purchase_order' })
      const stated = fact({ label: 'stated total', value: g.invoiced as number, source: 'invoice' }) as number
      const sum = fact({ label: 'sum of lines (+ allowed freight)', value: g.expected as number, source: 'computed', from: ['invoice line amounts'] }) as number
      // an amount plus a direction in words; a signed "-90.00" in a letter is both unclear and easy to misread
      const diff = fact({ label: 'difference', value: r2(Math.abs(stated - sum)), source: 'computed', from: ['stated total', 'sum of lines (+ allowed freight)'] }) as number
      const dir = stated > sum ? 'above' : 'below'
      return {
        ...base, kind: 'vendor_query',
        subject: `${inv} (${po}): total ${money(stated)} does not match its lines (${money(sum)})`,
        body: `Hello,\n\n${inv} states a total of ${money(stated)}, but its lines add up to ${money(sum)}; the stated total is ${money(diff)} ${dir} them.` +
          ` Please send a corrected invoice. We will hold payment until it arrives.\n\nThank you.`,
        facts,
      }
    }

    case 'hold_no_po': {
      const cited = typeof g.invoiced === 'string' ? g.invoiced : null
      const open = String(g.expected ?? po)
      if (cited) fact({ label: 'PO cited on invoice', value: cited, source: 'invoice' })
      fact({ label: 'open PO', value: open, source: 'purchase_order' })
      const typo = cited !== null && isTransposition(cited, open)
      return {
        ...base, kind: 'vendor_query',
        subject: `${inv}: PO reference ${cited ?? 'missing'}`,
        body: `Hello,\n\n${inv} ${cited ? `cites ${cited}` : 'does not cite a purchase order'}; the open order we have is ${open}.` +
          (typo ? ` That looks like two digits transposed.` : '') + ` Please confirm the PO, or reissue the invoice against ${open}.\n\nThank you.`,
        facts,
      }
    }

    case 'hold_duplicate':
      return { ...base, kind: 'do_not_pay', subject: `${inv}: already booked, do not pay`, body: `${inv} matches an invoice already booked.\n- ${check.reasons.join('\n- ')}`, facts }
  }
  return { ...base, kind: 'review', subject: `${inv}: needs a person`, body: check.reasons.join('\n'), facts }
}
