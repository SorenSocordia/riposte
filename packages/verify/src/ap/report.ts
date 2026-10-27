/**
 * The AP decision in plain words (2026-10-05): a short block for a person, printed beside the JSON (the CLI
 * writes this on stderr and the verdict on stdout). It reads the result and, when given, the documents it was checked against,
 * and quotes the exact lines it read. Rendering only: it never changes the result, and nothing in a verdict depends on it.
 *
 *   HOLD: hold_quantity. Do not pay.
 *   Invoice AJ-97466 · PO PO-49051
 *   Why:
 *     - Machine grease cartridge 14 oz: billed 10, received 7 — more billed than received. (Invoice line "GREASE CART 14OZ".)
 *   Lines read:
 *     - invoice, line 4: "2   GREASE CART 14OZ | 10 | 6.95 | 69.50"
 *     - goods receipt, line 3: "2. Machine grease cartridge 14 oz | received 7"
 *   Who may clear it:
 *     - the buyer (buyer), for ap.line[1].quantity, for this verdict only
 *   Checks: 6 passed, 1 failed, 0 could not run.
 *   The full verdict is the JSON on stdout.
 *
 * 2026-10-05: "Lines read" is printed on every outcome (when the deciding check read no line, the lines the other checks
 * read, said to be theirs; else "none"); a person-decides headline names the open check first; a hold or an abstain says who
 * may clear it (the verdict's authority remedies) and, when an input is missing, what would settle it.
 *
 * Deterministic; no I/O.
 */
import { sha256 } from '../verdict/canonical.js'
import type { ClaimVerdict, Evidence } from '../verdict/schema.js'
import type { ApDocuments, ApResult } from './index.js'
import { resolvePointer, type ApStructuredDocuments } from './structured.js'
import { moneyWords } from './words.js'

export interface ApReportOptions {
  /** the documents the result was checked against, so the lines it read can be quoted (the three texts, or the structured input) */
  documents?: ApDocuments | ApStructuredDocuments
  /** at most this many lines quoted (default 12); the rest are counted */
  maxLines?: number
  /** the closing pointer to the JSON (default: 'The full verdict is the JSON on stdout.'); '' leaves it out */
  jsonNote?: string
}

const HEAD: Record<string, string> = {
  approve: 'APPROVE. Every check that ran passed.',
  abstain: 'A PERSON DECIDES. The check could not decide this bill; do not pay it automatically.',
}
const SRC_NAME: Record<string, string> = { invoice: 'invoice', purchase_order: 'purchase order', goods_receipt: 'goods receipt', contract: 'purchase order', evidence: 'item receipt', history: 'payment history' }

const clip = (s: string, n = 140): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const one = (s: string): string => s.replace(/\s+/g, ' ').trim()

/** A check in words, with its claim id: "the duplicate check (ap.duplicate)". */
function checkName(id: string): string {
  const m = /^ap\.(bill_)?line\[([^\]]+)\]\.(quantity|price|amount|billed_to_date)$/.exec(id)
  const words = id === 'ap.duplicate' ? 'the duplicate check' : id === 'ap.po_number' ? 'the PO number check' : id === 'ap.total' ? 'the total check'
    : id === 'ap.po_balance' ? 'the PO balance check' : id === 'ap.vendor' ? 'the vendor check' : id === 'ap.tax' ? 'the tax check'
    : id === 'ap.remittance' ? 'the payment-details check'
    : m ? `the ${m[3] === 'amount' ? 'line amount' : m[3] === 'billed_to_date' ? 'billed-to-date' : m[3]} check on ${m[1] ? 'bill ' : ''}line ${m[2]}` : 'the check'
  return `${words} (${id})`
}

/** The roles a remedy may name, in words. */
const ROLE: Record<string, string> = { 'ap-controller': 'the AP controller', 'ap-clerk': 'an AP clerk', 'ap-supervisor': 'an AP supervisor', buyer: 'the buyer' }

/** The headline: a person decides names the open check first ("cannot decide <claim>: ..." is the first reason then). */
function head(r: ApResult): string {
  if (r.decision === 'approve') return HEAD.approve!
  if (r.decision === 'abstain') {
    const m = /^cannot decide (.+?): /.exec(r.reasons[0] ?? '')
    if (!m) return HEAD.abstain!
    const c = r.verdict.claims.find((x) => x.claim_id === m[1])
    // engine 0.6.0: billed to date over the order is said as what it is
    if (c?.claim_id === 'ap.po_balance' && c.insufficiency?.reason === 'AMBIGUOUS_REFERENCE') return `A PERSON DECIDES. Open first: ${checkName(m[1]!)} found more billed on the order than it totals. Do not pay this bill automatically.`
    // engine 0.6.0: the vendor and tax checks say what they found
    const found = c ? foundWords(c) : null
    if (found) return `A PERSON DECIDES. Open first: ${checkName(m[1]!)} ${found}. Do not pay this bill automatically.`
    const what = c?.insufficiency?.reason === 'REFERENCE_NOT_PROVIDED' ? 'did not run' : 'could not decide this bill'
    return `A PERSON DECIDES. Open first: ${checkName(m[1]!)} ${what}. Do not pay this bill automatically.`
  }
  return `HOLD: ${r.decision}. Do not pay.`
}

/** What an open vendor or tax check found, in a headline's words (2026-10-05), or null for any other claim. */
function foundWords(c: ClaimVerdict): string | null {
  const reason = c.insufficiency?.reason
  // 2026-10-06: the payment-details check and the billed-to-date check say what they found
  if (c.claim_id === 'ap.remittance') {
    const f = String(c.computation?.operands?.found ?? '')
    // ruleset 0.4.0: the opening step of a payment redirection is said in the claim's own words
    if (/^the opening step of a payment redirection/.test(f)) return `found ${f}`
    // ruleset 0.3.0: an announced change, or a promise of payment instructions, is said as such
    return /announced/.test(f) ? 'found an announced change of payment details, or a promise of payment instructions' : /change/.test(f) ? 'found a request to change where payment goes' : /channel|payee/.test(f) ? 'found where to send payment outside the vendor master (a payment app, a link or a payee address)' : 'found bank-account details printed on the bill'
  }
  if (/\.billed_to_date$/.test(c.claim_id) && reason === 'AMBIGUOUS_REFERENCE') return 'found more billed to date on the line than was received'
  // engine 0.7.0: an invoice line that matches no purchase-order line, or does not name the item of the one it was paired with
  if (/^ap\.bill_line\[/.test(c.claim_id) && reason === 'AMBIGUOUS_REFERENCE' && /matches no purchase-order line|does not name the item|too weakly to check/.test(c.insufficiency?.detail ?? '')) {
    return /matches no purchase-order line/.test(c.insufficiency?.detail ?? '') ? 'found a bill line that matches no purchase-order line' : 'found a bill line that does not name the item of the purchase-order line it was read against'
  }
  if (c.claim_id === 'ap.vendor') {
    if (reason === 'FIELD_MISSING') return "could not compare the bill's vendor with the purchase order's"
    const match = c.computation?.operands?.vendor_match
    // ruleset 0.4.0: a Reply-To at another domain than the sender's
    if (match === 'reply-to') return 'found a Reply-To at another domain than the address the bill was sent from'
    if (c.computation?.operands?.read_by === null) return "found that the invoice does not name the purchase order's vendor"
    if (match === 'near' && c.computation?.operands?.read_by === 'sender address') return "found a sender writing from a look-alike of the vendor's domain"
    // 2026-10-06: a free-mail sender, and a domain on file from the vendor's booked bills
    if (match === 'free-mail') return 'found a sender writing from a free-mail address'
    // engine 0.7.0: a display name shaped like another address, and a sender whose domain is not built from the vendor's name
    if (match === 'display-name') return "found a From line whose display name is another address than the sender's"
    if (match === 'not-built') return "found a sender writing from a domain not built from the vendor's name"
    if (match === 'different' && c.computation?.operands?.read_by === 'sender address') return c.computation?.operands?.po_domain !== undefined ? 'found a sender writing from another domain than the one the purchase order names' : "found a sender writing from another domain than the vendor's booked bills came from"
    return match === 'near' ? "found a vendor name that only looks like the purchase order's"
      : match === 'records' ? "found the bill under another vendor record than the purchase order's"
        : match === 'conflict' ? "found that the bill's and the purchase order's tax ids disagree"
          : "found that the bill is from another vendor than the purchase order's"
  }
  if (c.claim_id === 'ap.tax') {
    return reason === 'FIELD_MISSING' ? 'found tax billed on a purchase order that states no tax terms'
      : reason === 'AMBIGUOUS_REFERENCE' ? "found tax that is not the purchase order's rate on its taxable lines"
        : reason === 'AMBIGUOUS_FIELD' ? 'found a negative tax on the bill' : null
  }
  return null
}

/**
 * The tax line (2026-10-05: "the tax figure never appears on an approve"): structured input says what tax the bill
 * carries and how it was read; the text path, on an approve, says no tax was read (every amount was a line, the total or
 * freight, or the bill would not have been approved). Null where there is nothing true to say in one line.
 */
function taxLine(r: ApResult, d: ApReportOptions['documents']): string | null {
  const c = r.verdict.claims.find((x) => x.claim_id === 'ap.tax')
  if (d && 'bill' in d) {
    const tax = d.bill.tax
    if (tax === undefined || tax === null) return 'Tax: none billed.'
    if (!c) return `Tax: ${JSON.stringify(typeof tax === 'object' ? tax.amount : tax)} billed (not checked against the purchase order).`
    const ops = c.computation?.operands ?? {}
    const M = (n: unknown): string => (typeof n === 'number' ? moneyWords(n, 2) : JSON.stringify(n))
    const pct = (x: unknown): string => (typeof x === 'number' ? `${Math.round(x * 1e6) / 1e4}%` : JSON.stringify(x))
    if (ops.tax === 0 || (typeof ops.tax === 'number' && Math.abs(ops.tax) < 0.005)) return `Tax: none billed${typeof ops.tax_rate === 'number' ? `; the purchase order states ${pct(ops.tax_rate)}` : ''}.`
    if (c.insufficiency?.reason === 'AMBIGUOUS_FIELD') return `Tax: ${M(ops.tax)} billed, a negative tax.`
    // 2026-10-06: the run's tax policy, said where the reader looks
    if (ops.tax_policy === 'allow') return `Tax: ${M(ops.tax)} billed; the purchase order states no tax terms, and this run's tax policy (--tax allow) accepts it as billed.`
    if (ops.tax_policy === 'rate') return `Tax: ${M(ops.tax)} billed; the purchase order states no tax terms, so this run's tax rate applies: ${pct(ops.tax_rate)} of the taxable lines (${M(ops.taxable_lines)}) is ${M(c.computation?.result)}.`
    if (ops.tax_rate === null || ops.tax_rate === undefined) return `Tax: ${M(ops.tax)} billed; the purchase order states no tax terms.`
    if (ops.tax_rate === 0) return `Tax: ${M(ops.tax)} billed; the purchase order states a tax rate of 0%.`
    return `Tax: ${M(ops.tax)} billed; ${pct(ops.tax_rate)} of the taxable lines (${M(ops.taxable_lines)}) is ${M(c.computation?.result)}.`
  }
  // engine 0.7.0: the text path reads a tax line, and the rate the purchase order states
  if (c) {
    const ops = c.computation?.operands ?? {}
    const M = (n: unknown): string => (typeof n === 'number' ? moneyWords(n, 2) : JSON.stringify(n))
    const at = c.evidence[0]?.locator.kind === 'span' && c.evidence[0].locator.line !== undefined ? ` (invoice line ${c.evidence[0].locator.line})` : ''
    if (typeof ops.tax === 'number' && Math.abs(ops.tax) < 0.005) return `Tax: none billed${at}.`
    if (c.insufficiency?.reason === 'AMBIGUOUS_FIELD') return `Tax: ${M(ops.tax)} billed${at}, a negative tax.`
    if (ops.tax_rate === null || ops.tax_rate === undefined) return `Tax: ${M(ops.tax)} billed${at}; the purchase order states no tax rate.`
    if (ops.tax_rate === 0) return `Tax: ${M(ops.tax)} billed${at}; the purchase order states a tax rate of 0%.`
    return `Tax: ${M(ops.tax)} billed${at}; ${Math.round(Number(ops.tax_rate) * 1e6) / 1e4}% of the taxable lines (${M(ops.taxable_lines)}) is ${M(c.computation?.result)}.`
  }
  // 2026-10-06: what was read, never a universal "none"
  return r.decision === 'approve' ? 'Tax: no amount on the invoice was read as tax (every amount on it was read as a line, the total or freight).' : null
}

/**
 * The freight line (2026-10-05): only when the bill carries freight, and said by who allowed it, the PO or the run's freight
 * policy (`ap --freight allow`), so an approve under the policy never hides it.
 */
function freightLine(r: ApResult): string | null {
  const t = r.verdict.claims.find((x) => x.claim_id === 'ap.total')
  const ops = t?.computation?.operands
  if (!ops || typeof ops.freight !== 'number' || ops.freight === 0) return null
  return ops.freight_policy === 'allow'
    ? `Freight: ${moneyWords(ops.freight, 2)} billed; the purchase order does not say whether freight is allowed, and this run's freight policy (--freight allow) allows it.`
    : `Freight: ${moneyWords(ops.freight, 2)} billed; the purchase order allows freight.`
}

/** The claims a reader needs to see the lines of: what failed and what could not run, else (a clean approve) every claim. */
function decisive(claims: readonly ClaimVerdict[]): ClaimVerdict[] {
  const open = claims.filter((c) => c.outcome !== 'PASS')
  return open.length ? open : [...claims]
}

/** One evidence item as a quoted line, or null when it names nothing a reader can look up. */
function quote(e: Evidence, docs: ApReportOptions['documents'], texts: Map<string, [string, string]>): string | null {
  const l = e.locator
  if (l.kind === 'span') {
    const hit = texts.get(l.source_hash)
    if (hit) {
      const [name, text] = hit
      return `${name}${l.line !== undefined ? `, line ${l.line}` : ''}: "${clip(one(text.slice(l.start, l.end)))}"`
    }
    return `a document${l.line !== undefined ? `, line ${l.line}` : ''}: ${JSON.stringify(e.value)}`
  }
  if (l.kind === 'field') {
    const path = l.path
    const v = docs && 'bill' in docs && path.startsWith('/') ? resolvePointer(docs, path) : undefined
    const shown = v !== undefined && typeof v !== 'object' ? JSON.stringify(v) : JSON.stringify(e.value)
    // the payment history as a whole, said as its count of booked invoices ("payment history: 0 entries")
    if (l.source === 'history' && path === 'history' && typeof e.value === 'number') return `payment history: ${e.value} ${e.value === 1 ? 'entry' : 'entries'}`
    return `${SRC_NAME[l.source] ?? l.source} ${path} = ${clip(shown ?? 'null', 100)}`
  }
  return null
}

/** The plain-English block for an AP result. Ends with a newline. */
export function formatApReport(r: ApResult, opts: ApReportOptions = {}): string {
  const out: string[] = [head(r)]
  const g = r.grounding
  const ids = [g.invoice_number ? `Invoice ${g.invoice_number}` : 'Invoice number unclear', g.po_number ? `PO ${g.po_number}` : 'no single PO number read']
  out.push(ids.join(' · '))
  if (g.item !== null || g.invoiced !== null || g.expected !== null) {
    // the reference value in the reason's own word: a quantity hold compares with what was received ("billed 10, received 7")
    const ref = r.decision === 'hold_quantity' ? 'received' : 'expected'
    out.push(`Grounding: ${[g.item ? `item "${g.item}"` : '', g.invoiced !== null ? `billed ${g.invoiced}` : '', g.expected !== null ? `${ref} ${g.expected}` : ''].filter(Boolean).join(', ')}`)
  }

  out.push('Why:')
  for (const reason of r.reasons) out.push(`  - ${one(reason)}`)
  const d = opts.documents
  const tl = taxLine(r, d)
  if (tl) out.push(tl)
  const fl = freightLine(r)
  if (fl) out.push(fl)

  // the exact lines read, for the claims that decided it
  const texts = new Map<string, [string, string]>()
  if (d && !('bill' in d)) {
    for (const [k, text] of [['invoice', d.invoice], ['purchase order', d.purchase_order], ['goods receipt', d.goods_receipt]] as const) texts.set(sha256(text), [k, text])
  }
  const quoted = (claims: readonly ClaimVerdict[]): string[] => {
    const seen = new Set<string>()
    const lines: string[] = []
    for (const c of claims) {
      for (const e of c.evidence) {
        const q = quote(e, d, texts)
        if (q === null || seen.has(q)) continue
        seen.add(q)
        lines.push(q)
      }
    }
    return lines
  }
  // Printed on every outcome (2026-10-05): when the deciding checks quote no line (a check that could not run reads none),
  // the lines the other checks read are shown, and said to be theirs.
  const deciding = decisive(r.verdict.claims)
  let lines = quoted(deciding)
  let label = 'Lines read:'
  if (!lines.length && deciding.length < r.verdict.claims.length) {
    lines = quoted(r.verdict.claims)
    label = 'Lines read (the open check read none; these are the lines the checks that ran read):'
  }
  // 2026-10-05: both vendors first, on every answer: the vendor check's own lines, else what the documents name
  const vc = r.verdict.claims.find((c) => c.claim_id === 'ap.vendor')
  const vendorFirst = vc ? quoted([vc]) : d && 'bill' in d ? [
    `invoice /bill/vendor = ${clip(JSON.stringify(d.bill.vendor?.name ?? d.bill.vendor?.id ?? null), 100)}`,
    `purchase order /purchase_order/vendor = ${d.purchase_order.vendor ? clip(JSON.stringify(d.purchase_order.vendor.name ?? d.purchase_order.vendor.id ?? null), 100) : 'none (the purchase order names no vendor)'}`,
  ] : []
  lines = [...vendorFirst, ...lines.filter((l) => !vendorFirst.includes(l))]
  const max = opts.maxLines ?? 12
  if (lines.length) {
    out.push(label)
    for (const q of lines.slice(0, max)) out.push(`  - ${q}`)
    if (lines.length > max) out.push(`  - (${lines.length - max} more in the JSON)`)
  } else {
    out.push('Lines read: none (no check quoted a document line).')
  }

  // Who may clear a hold or an abstain, and what would let an open check run: the verdict's own remedies for the deciding checks.
  if (r.decision !== 'approve') {
    const ids = new Set(deciding.map((c) => c.claim_id))
    const mine = (r.verdict.remedies ?? []).filter((x) => x.claims.some((id) => ids.has(id)))
    const who = mine.filter((x) => x.kind === 'authority' && x.authority)
    if (who.length) {
      out.push('Who may clear it:')
      for (const x of who) out.push(`  - ${ROLE[x.authority!] ?? x.authority} (${x.authority}), for ${x.claims.filter((id) => ids.has(id)).join(', ')}, for this verdict only`)
    }
    // only where an input is missing: an ambiguous match is settled by the person named above, not by a field
    const missing = new Set(deciding.filter((c) => c.outcome === 'INSUFFICIENT_DATA' && !String(c.insufficiency?.reason).startsWith('AMBIGUOUS')).map((c) => c.claim_id))
    const need = mine.filter((x) => x.kind === 'missing-operand' && x.claims.some((id) => missing.has(id)))
    if (need.length) {
      out.push('What would settle it:')
      for (const x of need) out.push(`  - ${one(x.detail)}`)
    }
  }

  const cov = r.verdict.coverage
  out.push(`Checks: ${cov.claims_pass} passed, ${cov.claims_fail} failed, ${cov.claims_insufficient} could not run.`)
  if (r.not_checked.length) {
    out.push('Not checked:')
    for (const n of r.not_checked) out.push(`  - ${one(n)}`)
  }
  const note = opts.jsonNote ?? 'The full verdict is the JSON on stdout.'
  if (note) out.push(note)
  return `${out.join('\n')}\n`
}
