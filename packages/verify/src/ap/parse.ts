/**
 * AP document readers — free-text invoice email, ERP purchase order, ERP goods receipt.
 *
 * Every value keeps its SPAN (character offsets + line number in its own document) so a verdict can point at exactly
 * where a number came from. Nothing here decides anything; ambiguity is reported, never resolved by guessing.
 *
 * Provenance: ported from the checker benchmarked blind on Distil Labs' public AP set (docs/BENCHMARK-AP.md,
 * run 1 frozen sha256 d1ad333f…), plus the two wording rules added in the disclosed run 2 ("amount payable" totals;
 * "freight may be added by the vendor" = allowed).
 */

export interface Span { start: number; end: number; line: number }
export interface Located<T> { value: T; span: Span }

export interface InvoiceLine { name: string; qty: number; unit: number; amount: number; amountMatchesQtyTimesUnit: boolean; span: Span }
export interface PoLine { index: number; name: string; qty: number; unit: number; span: Span }
export interface ReceiptLine { index: number; name: string; received: number; span: Span }

export interface ParsedInvoice {
  invoiceNumber: Located<string> | null
  invoiceNumberCandidates: string[]
  poNumbers: Located<string>[]
  lines: InvoiceLine[]
  totals: Located<number>[]
  freight: Located<number>[]
  /**
   * Money amounts on lines that are NOT a line item, the total, freight, or a known stray (previous balance, a quote…).
   * We do not guess whether they belong in the total — their presence makes the total check abstain. (Found by the
   * stress test: OCR-misspelled "Shippign and handling" was silently dropped and a good invoice was held.)
   */
  unclassified: (Located<number> & { text: string })[]
  /** a total line whose amount is written with unanchored space-grouping — ambiguous, never guessed */
  ambiguousTotal: string | null
  /** engine 0.7.0 (`readTax`): amounts on a tax line ("Sales tax 8.25%: USD 432.70", "Tax: USD 432.70"); empty otherwise */
  tax: (Located<number> & { text: string })[]
  /** engine 0.7.0 (`suffixNumbers`): each invoice-number candidate, in order of first appearance, with the lines it is on */
  invoiceNumberMentions: { value: string; lines: number[] }[]
  /** ruleset 0.3.0 (`subtotals`): amounts on a subtotal line ("Subtotal: USD 8,878.00"), read apart; empty otherwise */
  subtotals: (Located<number> & { text: string })[]
}
export interface ParsedPo { number: Located<string> | null; freightAllowed: boolean | null; lines: PoLine[]
  /**
   * The tax rate the purchase order states ("Tax: 8.25%", "Tax rate: 8.25%", "Sales tax: 8.25%"; "Tax: 0%", "none", "exempt"
   * state a rate of 0), as a fraction; null when it states none. Read only by engine 0.7.0 (./v070.ts).
   */
  taxRate: Located<number> | null
}

const NUM = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g

interface Num { value: number; text: string; index: number }

function numbersIn(s: string): Num[] {
  const raw: Num[] = []
  for (const m of s.matchAll(NUM)) {
    const i = m.index ?? 0
    const before = s[i - 1] ?? ''
    const after = s[i + m[0].length] ?? ''
    if (before === '-' || after === '-') continue // identifiers (PO-49051, AJ-97466) and dates
    if (/[A-Za-z]/.test(after) || /[A-Za-z]/.test(before)) continue // specs inside names (14OZ, 50FT, 12AWG)
    raw.push({ value: Number(m[0].replace(/,/g, '')), text: m[0], index: i })
  }
  // Space-grouped thousands ("$1 555.63", "USD 12 400.00") are ONE number only when anchored by a currency marker directly
  // before the first group — a currency sign is never followed by a quantity. (the stress test: "$1 555.63" was read as
  // 555.63 and a good invoice was held.) Unanchored space-grouping is left split; the total check abstains on it.
  const out: Num[] = []
  for (let k = 0; k < raw.length; k++) {
    const n = raw[k]!
    const anchored = /(?:USD|EUR|GBP|CAD|\$)\s*$/i.test(s.slice(Math.max(0, n.index - 5), n.index))
    if (anchored && /^\d{1,3}$/.test(n.text)) {
      let text = n.text, end = n.index + n.text.length, j = k + 1
      while (j < raw.length && /^\s{1,2}$/.test(s.slice(end, raw[j]!.index)) && /^\d{3}(?:\.\d+)?$/.test(raw[j]!.text)) {
        text += raw[j]!.text; end = raw[j]!.index + raw[j]!.text.length; j++
        if (/\./.test(text)) break
      }
      if (j > k + 1) { out.push({ value: Number(text), text: s.slice(n.index, end), index: n.index }); k = j - 1; continue }
    }
    out.push(n)
  }
  return out
}

/** A total line written with UNANCHORED space-grouping ("Total: 1 555.63 USD") — could be 1555.63 or 555.63; don't guess. */
const UNANCHORED_SPACE_GROUP = /(?<!(?:USD|EUR|GBP|CAD|\$)\s{0,2})\b\d{1,3}\s{1,2}\d{3}(?:\.\d{2})\b/i

export const close = (a: number, b: number, eps = 0.005): boolean => Math.abs(a - b) <= eps
export const round2 = (x: number): number => Math.round(x * 100) / 100

/** Split text into lines with absolute offsets. */
function linesOf(text: string): { text: string; start: number; line: number }[] {
  const out: { text: string; start: number; line: number }[] = []
  let pos = 0
  text.split('\n').forEach((t, i) => { out.push({ text: t, start: pos, line: i + 1 }); pos += t.length + 1 })
  return out
}
const spanOf = (l: { text: string; start: number; line: number }): Span => ({ start: l.start, end: l.start + l.text.length, line: l.line })

const TOTAL = /\btotal\b|amount\s+(?:payable|due)|balance\s+due|please\s+(?:pay|remit)/i
const NOT_TOTAL = /sub-?\s*total|previous|balance on|balance forward|quote|valid|credit|paid|deposit|outstanding|overdue|last month|prior/i
const FREIGHT = /freight|shipping|delivery charge|carriage/i
/** Amounts that are explicitly NOT part of this invoice's total (known strays). Anything else unclassified -> abstain. */
const STRAY = /previous|balance on|balance forward|quote|valid until|credit|deposit|already paid|paid on|outstanding|overdue|last month|prior|not part of this invoice/i
/** A money-looking amount: two decimals, or adjacent to a currency marker. */
const MONEY = /(?:USD|EUR|GBP|CAD|\$)\s*\d[\d, ]*(?:\.\d{2})?|\d[\d,]*\.\d{2}/i

/**
 * Engine 0.6.0 (2026-10-05): a number that names something rather than an amount. "Please remit to our new
 * bank account ending 9921" was read as a second stated total (7500 and 9921), and the safe outcome happened by luck. On a
 * total line, a number right after one of these words (an account, routing, phone, ZIP or reference number), a phone number,
 * or a five-digit ZIP after a state code is never the total.
 */
const IDENTIFIER_BEFORE = /(?:\b(?:account|acct|a\/c|routing|aba|iban|swift|bic|sort\s+code|ending(?:\s+in)?|ends\s+in|last\s+(?:four|4)|phone|tel|telephone|fax|mobile|cell|call|zip|postal\s+code|p\.?\s*o\.?\s+box|box|suite|ste|job|ticket|ref|reference|order|check|cheque|no\.?|number)|#)\s*[:#.]?\s*(?:no\.?\s*|#\s*)?$/i
const PHONE = /\(?\b\d{3}\)?[\s.]\d{3}[\s.]\d{4}\b/g
/**
 * Engine 0.6.0 (2026-10-06): an IBAN ("GB00 EVIL 0000 0000 0000 00") on a "please remit" line was read as a
 * second stated total (0), and the bill went to a person over its total instead of its bank change. Every number inside an
 * IBAN-shaped run, or inside a run of digit groups after an identifier word ("account 1234 5678"), names something.
 */
const IBAN = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?\b/g
function identifierNumber(line: string, n: Num, prev?: { n: Num; identifier: boolean }): boolean {
  if (IDENTIFIER_BEFORE.test(line.slice(Math.max(0, n.index - 32), n.index))) return true
  if (/^\d{5}$/.test(n.text) && /\b[A-Z]{2}\s+$/.test(line.slice(Math.max(0, n.index - 4), n.index))) return true
  for (const m of line.matchAll(PHONE)) if (n.index >= (m.index ?? 0) && n.index < (m.index ?? 0) + m[0].length) return true
  for (const m of line.matchAll(IBAN)) if (n.index >= (m.index ?? 0) && n.index < (m.index ?? 0) + m[0].length) return true
  // the next group of an identifier's digits ("account 1234 5678": 5678 is the same identifier, not an amount)
  if (prev?.identifier && /^[\s-]{1,2}$/.test(line.slice(prev.n.index + prev.n.text.length, n.index)) && !/\./.test(n.text)) return true
  return false
}
/** Two decimals, or a currency marker right before or after it. */
const moneyLooking = (line: string, n: Num): boolean =>
  /\.\d{2}$/.test(n.text) || /(?:USD|EUR|GBP|CAD|\$)\s{0,2}$/i.test(line.slice(Math.max(0, n.index - 5), n.index)) || /^\s{0,2}(?:USD|EUR|GBP|CAD)\b/i.test(line.slice(n.index + n.text.length))

export interface ParseInvoiceOptions {
  /**
   * Engine 0.6.0 (2026-10-05): a stated total is an amount on a line that carries a total label (Total,
   * Amount due or payable, Balance due, Invoice total, "please pay/remit"), never an account, routing, phone, ZIP or reference
   * number on it; a total line with no such amount is not a total. Earlier engines read as before.
   */
  strictTotals?: boolean
  /**
   * Engine 0.7.0 (2026-10-13): a line whose label is tax ("Sales tax 8.25%: USD 432.70", "Tax: USD 432.70") is read as the
   * bill's tax, never as an amount that is not a line item, the total or freight. Earlier engines read as before.
   */
  readTax?: boolean
  /**
   * Engine 0.7.0 (2026-10-13): an invoice number is read with its suffix ("GCS-20417A", "AJ-97466-1"), never cut to the number
   * it extends. Earlier engines read as before.
   */
  suffixNumbers?: boolean
  /**
   * Ruleset ap-threeway 0.3.0 (2026-10-14): a subtotal line ("Subtotal: USD 8,878.00") is read as the bill's subtotal, never as
   * an amount that is not a line item, the total or freight. Nearly every taxed supplier bill prints one; whether it is the
   * lines' sum is the total check's to say (src/ap/index.ts). Earlier rulesets read as before.
   */
  subtotals?: boolean
  /**
   * Ruleset 0.3.0 (2026-10-14): a unit price written per thousand or per hundred ("USD 189.00/M", "189.00 per M", "/C", "per
   * 1,000", "per hundred"), as wire and fasteners are priced, is read as the price of one unit (189.00/M is 0.189 each). The
   * capital M and C are the trade's; a lowercase "/m" (per metre) is not read. Earlier rulesets read as before.
   */
  pricePer?: boolean
  /**
   * Ruleset 0.3.0 (2026-10-14): an invoice number written as a distributor writes it ("S104412558.001", "1044125580") is read
   * when it follows the word "invoice" ("Invoice S104412558.001"): one to four letters or none, five to twelve digits, an
   * optional ".001" suffix. Away from the word, only the hyphenated shape is read, as before. Earlier rulesets read as before.
   */
  plainNumbers?: boolean
}

/** Ruleset 0.3.0 (`pricePer`): a per-thousand or per-hundred marker right after a price, and the divisor it names. */
const PRICE_PER = /^\s*(?:\/|per\s+)(M|C|1,?000|100|thousand|hundred)\b/i
function pricePerDivisor(after: string): number | null {
  const m = PRICE_PER.exec(after)
  if (!m) return null
  const u = m[1]!
  // the trade's capitals only: "/m" is a metre, not a thousand
  if (u === 'M' || u === '1000' || u === '1,000' || u.toLowerCase() === 'thousand') return 1000
  if (u === 'C' || u === '100' || u.toLowerCase() === 'hundred') return 100
  return null
}
/** A subtotal line's label ("Subtotal", "Sub-total", "Sub total", "Merchandise subtotal"), never "total". */
const SUBTOTAL_LINE = /\bsub-?\s*total\b/i

/** A tax line's label at its start (engine 0.7.0): "Sales tax", "Tax", "Use tax", never "Tax ID", "tax exempt" or a tax number. */
const TAX_LINE = /^\s*[-*•]?\s*(?:(?:sales|use|state|local|county|city|excise)\s+)?tax(?:es)?\b(?!\s*(?:id\b|i\.d\.|exempt|number|no\b|#|reg|registration|certificate))/i

export function parseInvoice(text: string, opts: ParseInvoiceOptions = {}): ParsedInvoice {
  // engine 0.7.0: a suffix after the number ("GCS-20417A", "AJ-97466-1") is part of it
  const NO = opts.suffixNumbers ? '[A-Z]{2,4}-\\d{4,6}(?:-\\d{1,3}|-?[A-Z]{1,2})?' : '[A-Z]{2,4}-\\d{4,6}'
  // ruleset 0.3.0: after the word "invoice", a distributor's number too ("S104412558.001"); a PO number is never one
  const EXPLICIT = opts.plainNumbers ? `${NO}|(?!PO-)[A-Z]{0,4}\\d{5,12}(?:\\.\\d{1,3})?` : NO
  const explicit = [...text.matchAll(new RegExp(`invoice\\s*(?:no\\.?|number|#|:)?\\s*(${EXPLICIT})\\b`, 'gi'))]
  const all = [...text.matchAll(new RegExp(`\\b(${NO})\\b`, 'g'))].filter((m) => !/^(PO|Q|QT|QUO|REF|RMA)-/i.test(m[1]!))
  const pool = explicit.length ? explicit : all
  const candidates = [...new Set(pool.map((m) => m[1]!.toUpperCase()))]
  const lineAt = (i: number): number => text.slice(0, i).split('\n').length
  const invoiceNumberMentions: { value: string; lines: number[] }[] = []
  if (opts.suffixNumbers) {
    for (const m of pool) {
      const v = m[1]!.toUpperCase(), at = lineAt((m.index ?? 0) + m[0].lastIndexOf(m[1]!))
      const hit = invoiceNumberMentions.find((x) => x.value === v)
      if (!hit) invoiceNumberMentions.push({ value: v, lines: [at] })
      else if (!hit.lines.includes(at)) hit.lines.push(at)
    }
  }
  let invoiceNumber: Located<string> | null = null
  if (candidates.length === 1) {
    const m = pool[0]!
    const start = (m.index ?? 0) + m[0].lastIndexOf(m[1]!)
    invoiceNumber = { value: candidates[0]!, span: { start, end: start + m[1]!.length, line: text.slice(0, start).split('\n').length } }
  }
  const seenPo = new Set<string>()
  const poNumbers: Located<string>[] = []
  for (const m of text.matchAll(/\b(PO-\d+)\b/g)) {
    if (seenPo.has(m[1]!)) continue
    seenPo.add(m[1]!)
    const start = m.index ?? 0
    poNumbers.push({ value: m[1]!, span: { start, end: start + m[1]!.length, line: text.slice(0, start).split('\n').length } })
  }

  const lines: InvoiceLine[] = []
  const totals: Located<number>[] = []
  const freight: Located<number>[] = []
  const unclassified: (Located<number> & { text: string })[] = []
  const tax: (Located<number> & { text: string })[] = []
  const subtotals: (Located<number> & { text: string })[] = []
  let ambiguousTotal: string | null = null
  for (const l of linesOf(text)) {
    const line = l.text.trim()
    if (!line) continue
    // ruleset 0.3.0: a price per thousand or per hundred ("189.00/M") is the price of one unit
    const nums = numbersIn(l.text).map((n) => {
      if (!opts.pricePer) return n
      const d = pricePerDivisor(l.text.slice(n.index + n.text.length))
      return d === null ? n : { ...n, value: n.value / d }
    })
    // engine 0.7.0: a tax line's amount is the bill's tax (a rate printed beside it, "8.25%", is never the amount)
    if (opts.readTax && TAX_LINE.test(l.text)) {
      const pick = nums.filter((n) => !/^\s*%/.test(l.text.slice(n.index + n.text.length)) && moneyLooking(l.text, n)).pop()
      if (pick) { tax.push({ value: pick.value, span: spanOf(l), text: line }); continue }
    }
    // ruleset 0.3.0: a subtotal line is the bill's subtotal, read apart (the total check says whether it is the lines' sum)
    if (opts.subtotals && SUBTOTAL_LINE.test(l.text) && !/\btotal\b/i.test(l.text.replace(SUBTOTAL_LINE, ''))) {
      const pick = nums.filter((n) => moneyLooking(l.text, n)).pop() ?? nums[nums.length - 1]
      if (pick) { subtotals.push({ value: pick.value, span: spanOf(l), text: line }); continue }
    }
    const unclassify = (): void => {
      if (!MONEY.test(l.text) || STRAY.test(l.text)) return
      const money = nums.filter((n) => /\.\d{2}$/.test(n.text))
      const pick = money[money.length - 1] ?? nums[nums.length - 1]
      if (pick) unclassified.push({ value: pick.value, span: spanOf(l), text: line })
    }
    if (TOTAL.test(l.text) && !NOT_TOTAL.test(l.text) && nums.length) {
      const kw = l.text.search(TOTAL)
      if (opts.strictTotals) {
        // engine 0.6.0: only an amount can be the total; a total line with none (an account number, a phone number) is read on
        let prevNum: { n: Num; identifier: boolean } | undefined
        const usable = nums.filter((n) => { const identifier = identifierNumber(l.text, n, prevNum); prevNum = { n, identifier }; return !identifier })
        const after = usable.filter((n) => n.index > kw)
        const pool = after.length ? after : usable
        const pick = pool.filter((n) => moneyLooking(l.text, n))[0] ?? pool[pool.length - 1]
        if (pick) {
          if (UNANCHORED_SPACE_GROUP.test(l.text)) { ambiguousTotal = line; continue }
          totals.push({ value: pick.value, span: spanOf(l) })
          continue
        }
      } else {
        if (UNANCHORED_SPACE_GROUP.test(l.text)) { ambiguousTotal = line; continue }
        const money = nums.filter((n) => n.index > kw && /\.\d{2}$/.test(n.text))
        totals.push({ value: (money[0] ?? nums[nums.length - 1]!).value, span: spanOf(l) })
        continue
      }
    }
    if (FREIGHT.test(l.text) && nums.length && !/not allowed|no freight/i.test(l.text)) {
      freight.push({ value: nums[nums.length - 1]!.value, span: spanOf(l) })
      continue
    }
    if (nums.length < 3) { unclassify(); continue }
    let best: { q: number; u: number; t: number; exact: boolean; idx: [number, number, number] } | null = null
    for (let i = 0; i < nums.length; i++) for (let j = i + 1; j < nums.length; j++) for (let k = j + 1; k < nums.length; k++) {
      const q = nums[i]!.value, u = nums[j]!.value, t = nums[k]!.value
      if (!Number.isInteger(q) || q <= 0 || u <= 0) continue
      if (close(round2(q * u), t, 0.011) && (!best || k > best.idx[2])) best = { q, u, t, exact: true, idx: [i, j, k] }
    }
    if (!best) {
      const n = nums.length
      const [a, b, c] = [nums[n - 3]!, nums[n - 2]!, nums[n - 1]!]
      if (Number.isInteger(a.value) && a.value > 0 && Math.abs(a.value * b.value - c.value) / Math.max(c.value, 1) < 0.25) {
        best = { q: a.value, u: b.value, t: c.value, exact: false, idx: [n - 3, n - 2, n - 1] }
      }
    }
    if (!best) { unclassify(); continue }
    let named = l.text
    for (const k of [...best.idx].sort((x, y) => y - x)) {
      const nm = nums[k]!
      named = named.slice(0, nm.index) + ' '.repeat(nm.text.length) + named.slice(nm.index + nm.text.length)
    }
    const pick = best
    const name = named
      .replace(/^\s*[-*•]?\s*\d{1,2}[.)]?\s+(?=\S)/, (m) => (/^\s*[-*•]?\s*\d{1,2}[.)]?\s+$/.test(m) && pick.idx[0] !== 0 ? ' ' : m))
      .replace(/\b(USD|EUR|GBP|CAD)\b|\$/gi, ' ')
      .replace(/[|@=×]|\bx\b/gi, ' ')
      .replace(/^[\s\-*•]+/, '')
      .replace(/\s+/g, ' ')
      .trim()
    lines.push({ name, qty: best.q, unit: best.u, amount: best.t, amountMatchesQtyTimesUnit: best.exact, span: spanOf(l) })
  }
  return { invoiceNumber, invoiceNumberCandidates: candidates, poNumbers, lines, totals, freight, unclassified, ambiguousTotal, tax, invoiceNumberMentions, subtotals }
}

export function parsePurchaseOrder(text: string): ParsedPo {
  let number: Located<string> | null = null
  const nm = text.match(/\b(PO-\d+)\s*\|\s*Vendor/)
  if (nm) {
    const start = nm.index ?? 0
    number = { value: nm[1]!, span: { start, end: start + nm[1]!.length, line: text.slice(0, start).split('\n').length } }
  }
  const frText = text.match(/Freight:\s*([^|\n]+)/i)?.[1]?.trim().toLowerCase()
  const freightAllowed = frText === undefined ? null
    : /not allowed|not permitted|no freight|included in price|vendor pays/.test(frText) ? false
    : /allowed|permitted|may be added|billable|added by the vendor/.test(frText) ? true
    : null
  const lines: PoLine[] = []
  for (const l of linesOf(text)) {
    const m = l.text.match(/^\s*(\d+)\.\s*(.+?)\s*\|\s*qty\s*([\d,.]+)\s*\|\s*unit\s*[A-Z]{3}\s*([\d,.]+)\s*$/)
    if (m) lines.push({ index: Number(m[1]), name: m[2]!.trim(), qty: Number(m[3]!.replace(/,/g, '')), unit: Number(m[4]!.replace(/,/g, '')), span: spanOf(l) })
  }
  // the tax rate the purchase order states, written as a percent ("Tax: 8.25%"), or none at all ("Tax: 0%", "none", "exempt")
  let taxRate: Located<number> | null = null
  for (const l of linesOf(text)) {
    if (/^\s*\d+\.\s/.test(l.text)) continue
    const t = /\b(?:sales\s+)?tax(?:\s+rate)?\s*:\s*([^|\n]+)/i.exec(l.text)
    if (!t) continue
    const v = t[1]!.trim().toLowerCase()
    const pct = /^(\d+(?:\.\d+)?)\s*%$/.exec(v)
    const value = pct ? Number(pct[1]) / 100 : /^(?:0|none|exempt|tax[- ]exempt|no tax|not taxable|non-?taxable)$/.test(v) ? 0 : null
    if (value !== null && value >= 0 && value <= 1) taxRate = { value: Math.round(value * 1e9) / 1e9, span: spanOf(l) }
    break
  }
  return { number, freightAllowed, lines, taxRate }
}

export function parseGoodsReceipt(text: string): ReceiptLine[] {
  const out: ReceiptLine[] = []
  for (const l of linesOf(text)) {
    const m = l.text.match(/^\s*(\d+)\.\s*(.+?)\s*\|\s*received\s*([\d,.]+)\s*$/)
    if (m) out.push({ index: Number(m[1]), name: m[2]!.trim(), received: Number(m[3]!.replace(/,/g, '')), span: spanOf(l) })
  }
  return out
}

// ---------- line matching (abbreviation-aware; spec numbers must agree) ----------

/** Options of the line match: `poles` is ruleset ap-threeway 0.3.0's reading of pole counts (below). */
export interface MatchOptions { poles?: boolean }

/**
 * Ruleset 0.3.0 (2026-10-14): a breaker's or switch's pole count, as a supply house writes it and as a purchase order spells
 * it: "1P", "1-pole", "single pole", "single-pole" are one word for the match; "2P", "double pole", "two pole" another; "3P",
 * "three pole", "triple pole" a third; "4P" a fourth. A cold reader's clean bill, "20A 1P BREAKER" against "Breaker 20A single
 * pole", matched too weakly to check (0.3) and went to a person. Nothing else is expanded.
 */
const POLES: readonly [RegExp, string][] = [
  [/\b(?:1|one|single)[\s-]*(?:p|pole)\b/gi, ' onepole '],
  [/\b(?:2|two|double)[\s-]*(?:p|pole)\b/gi, ' twopole '],
  [/\b(?:3|three|triple)[\s-]*(?:p|pole)\b/gi, ' threepole '],
  [/\b(?:4|four)[\s-]*(?:p|pole)\b/gi, ' fourpole '],
]
const poles = (s: string): string => POLES.reduce((t, [re, w]) => t.replace(re, w), s)

function tokens(s: string, opts: MatchOptions = {}): string[] {
  return (opts.poles ? poles(s) : s).toLowerCase()
    .replace(/(\d)([a-z])/g, '$1 $2').replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/[^a-z0-9. ]+/g, ' ').split(/\s+/).map((t) => t.replace(/\.$/, '')).filter(Boolean)
}

function tokenMatch(a: string, b: string): boolean {
  if (a === b) return true
  if (/^\d/.test(a) || /^\d/.test(b)) return false
  const [s, l] = a.length <= b.length ? [a, b] : [b, a]
  if (s.length < 2) return false
  if (l.startsWith(s)) return true
  if (s[0] !== l[0]) return false
  let j = 0
  for (const ch of l) if (ch === s[j]) j++
  return j === s.length
}

const STOP = new Set(['x', 'usd', 'ea', 'each', 'pc', 'pcs', 'unit', 'units', 'of', 'the', 'and', 'with', 'for', 'a'])

export function nameScore(invName: string, poName: string, opts: MatchOptions = {}): number {
  const a = tokens(invName, opts).filter((t) => !STOP.has(t))
  const b = tokens(poName, opts).filter((t) => !STOP.has(t))
  if (!a.length || !b.length) return 0
  const used = new Set<number>()
  let hit = 0
  for (const t of a) {
    const j = b.findIndex((u, k) => !used.has(k) && tokenMatch(t, u))
    if (j >= 0) { used.add(j); hit++ }
  }
  const numsB = new Set(b.filter((t) => /^\d/.test(t)))
  const numMiss = a.filter((t) => /^\d/.test(t) && !numsB.has(t)).length
  return hit / Math.min(a.length, b.length) - 0.5 * numMiss
}

export interface LineMatch { pairs: [number, number][]; margin: number; minScore: number }

/** Best one-to-one assignment of invoice lines to PO lines, with the margin over the runner-up (ambiguity signal). */
export function matchLines(inv: InvoiceLine[], po: PoLine[], opts: MatchOptions = {}): LineMatch | null {
  const n = inv.length
  if (n !== po.length || n === 0 || n > 8) return null
  const S = inv.map((il) => po.map((pl) => nameScore(il.name, pl.name, opts) +
    (close(il.unit, pl.unit, 0.005) ? 0.3 : Math.abs(il.unit - pl.unit) / pl.unit < 0.12 ? 0.1 : 0)))
  let best = -Infinity, second = -Infinity, bestPerm: number[] = []
  const perm = po.map((_, j) => j)
  const permute = (k: number): void => {
    if (k === n) {
      const tot = perm.reduce((acc, j, i) => acc + S[i]![j]!, 0)
      if (tot > best) { second = best; best = tot; bestPerm = [...perm] } else if (tot > second) second = tot
      return
    }
    for (let x = k; x < n; x++) { [perm[k], perm[x]] = [perm[x]!, perm[k]!]; permute(k + 1); [perm[k], perm[x]] = [perm[x]!, perm[k]!] }
  }
  permute(0)
  const pairs = bestPerm.map((j, i) => [i, j] as [number, number])
  return { pairs, margin: n === 1 ? Infinity : best - second, minScore: Math.min(...pairs.map(([i, j]) => S[i]![j]!)) }
}

// ---------- engine 0.7.0: the item a line bills, partial bills, and lines that match no PO line ----------

/** Size, unit and colour words a PO description carries around its item ("10 ft", "14 oz", "48 in", "white", "large"). */
const NOT_ITEM = new Set(['in', 'inch', 'inches', 'ft', 'feet', 'foot', 'mm', 'cm', 'm', 'oz', 'lb', 'lbs', 'g', 'kg', 'gal', 'gallon', 'gallons', 'l', 'ml',
  'awg', 'yd', 'yds', 'pk', 'ct', 'count', 'pc', 'pcs', 'ea', 'each', 'unit', 'units', 'v', 'w', 'amp', 'amps', 'volt', 'volts', 'watt', 'watts',
  'white', 'black', 'yellow', 'red', 'blue', 'green', 'orange', 'gray', 'grey', 'clear', 'brown', 'silver', 'small', 'medium', 'large', 'xl', 'xxl', 'heavy', 'duty', 'assorted', 'per'])

/**
 * The item word of a purchase-order line: its head noun, the last word of the description before a comma or a dash that is not a
 * number, a size, a unit or a colour ("conduit" in "3/4 in EMT conduit, 10 ft", "cartridge" in "Machine grease cartridge 14 oz").
 * Null when the description carries none.
 */
export function headNoun(poName: string): string | null {
  const before = poName.split(/,|\s[-–]\s/)[0]!
  const toks = before.toLowerCase().replace(/[^a-z0-9/.\- ]+/g, ' ').split(/\s+/).map((t) => t.replace(/^[.\-]+|[.\-]+$/g, '')).filter(Boolean)
  for (let i = toks.length - 1; i >= 0; i--) {
    const t = toks[i]!
    if (!/^[a-z][a-z-]*$/.test(t) || t.length < 2 || NOT_ITEM.has(t) || STOP.has(t)) continue
    return t
  }
  return null
}

/**
 * Material abbreviations a supply-house bill writes that no letter-by-letter reading recovers ("CU" for copper: the chemical
 * symbol, not a cut of the word). Read only as naming the word they stand for.
 */
const TRADE_ABBREVIATIONS: Readonly<Record<string, readonly string[]>> = {
  cu: ['copper'], al: ['aluminum', 'aluminium'], alum: ['aluminum', 'aluminium'], ss: ['stainless'], galv: ['galvanized', 'galvanised'],
}

/** A word as written, and with each neighbouring pair swapped (one slip, never two). */
function swapsOf(t: string): string[] {
  const out = [t]
  for (let i = 0; i + 1 < t.length; i++) if (t[i] !== t[i + 1]) out.push(t.slice(0, i) + t[i + 1] + t[i] + t.slice(i + 2))
  return out
}

/** A word as one token of another, run together ("HANDTRUCK" holds "truck", "ZIPTIE" holds "tie"): four letters or more. */
const holds = (t: string, w: string): boolean => w.length >= 3 && t.length > w.length && t.includes(w)
const singular = (w: string): string => (w.length > 3 && /[^s]s$/.test(w) ? w.slice(0, -1) : w)

/**
 * The words of a purchase-order description that say what the item is, apart from its head noun: alphabetic, three letters or
 * more, not a size, unit or colour, and not a family code (a word in capitals, "EMT" in "3/4 in EMT conduit": the code a
 * different item of the same family carries too).
 */
function itemWords(poName: string): string[] {
  const hasLower = /[a-z]/.test(poName)
  return (poName.match(/[A-Za-z]+/g) ?? []).filter((w) => w.length >= 3 && !NOT_ITEM.has(w.toLowerCase()) && !STOP.has(w.toLowerCase()) &&
    !(w === w.toUpperCase() && (hasLower || w.length <= 4))).map((w) => w.toLowerCase())
}

/**
 * True when an invoice line names the item of a purchase-order line: the PO line's head noun is on it, whole, as an
 * abbreviation ("CART" for cartridge, "RL" for roll, "PNLBRD" for panelboard: a prefix, or the same first letter and the rest in
 * order) or run into another word ("HANDTRUCK"); or, failing that, another word of the description that says what the item is
 * (itemWords: "ratchet" in "2 inch by 27 foot ratchet tie-down" for "Ratchet strap 2 in x 27 ft"). Sizes and family codes never
 * count: "3/4 EMT SET SCREW CONNECTOR" shares only "3/4" and "EMT" with "3/4 in EMT conduit, 10 ft", and does not name it. A
 * description with no word that says what the item is is not held to one.
 */
export function lineNamesItem(invName: string, poName: string): boolean {
  const head = headNoun(poName)
  const words = itemWords(poName)
  if (head === null && !words.length) return true
  // each word as written and with one neighbouring pair swapped back (a scanning or typing slip: "WRIE" for wire)
  const bill = tokens(invName).filter((t) => /^[a-z]/.test(t)).flatMap(swapsOf)
  const skeleton = (w: string): string => `${w[0]}${w.slice(1).replace(/[aeiou]/g, '')}`
  const names = (w: string): boolean => bill.some((t) => tokenMatch(t, w) || tokenMatch(t, singular(w)) || holds(t, singular(w)) ||
    // a word cut to its consonants inside a compound ("HNDTRCK" holds "trck", truck's)
    (skeleton(w).length >= 3 && t.length > skeleton(w).length && t.includes(skeleton(w))) || (TRADE_ABBREVIATIONS[t]?.includes(w) ?? false))
  return (head !== null && names(head)) || words.some(names)
}

/** The 0.7.0 line match: the pairs it trusts, the invoice lines it could not place, and the PO lines no line of the bill bills. */
export interface LineMatch070 {
  /** invoice line i bills PO line j */
  pairs: [number, number][]
  /** an invoice line with no PO line ('extra'), or whose nearest PO line it does not name ('item') or matches too weakly ('weak') */
  unmatched: { i: number; nearest: number | null; why: 'extra' | 'item' | 'weak'; item: string | null; score: number | null }[]
  /** PO lines no invoice line bills */
  unbilled: number[]
  /** set when no reading of the lines can be trusted (too many lines, or two matchings nearly as plausible); nothing else is then set */
  problem: string | null
}

/**
 * Engine 0.7.0: invoice lines matched to PO lines when their counts differ too. The best one-to-one assignment of the fewer lines
 * into the more (by the score matchLines uses), with its margin over the runner-up. A pair is trusted when it scores at least
 * 0.34 and the invoice line names the PO line's item (lineNamesItem). A PO line no invoice line bills is unbilled (a partial bill);
 * an invoice line left over, or in a pair that is not trusted, is unmatched, its nearest PO line named.
 */
export function matchLines070(inv: InvoiceLine[], po: PoLine[], opts: MatchOptions = {}): LineMatch070 {
  const none = (problem: string): LineMatch070 => ({ pairs: [], unmatched: [], unbilled: [], problem })
  const n = inv.length, m = po.length
  if (!n) return none('no invoice lines could be read')
  if (n > 8 || m > 8) return none('invoice lines could not be matched to PO lines')
  const S = inv.map((il) => po.map((pl) => nameScore(il.name, pl.name, opts) + (close(il.unit, pl.unit, 0.005) ? 0.3 : Math.abs(il.unit - pl.unit) / pl.unit < 0.12 ? 0.1 : 0)))
  let pairs: [number, number][]
  if (n === m) {
    const eq = matchLines(inv, po, opts)
    if (!eq) return none('invoice lines could not be matched to PO lines')
    if (eq.margin < 0.25) return none(`two different line matchings are nearly as plausible (margin ${eq.margin.toFixed(2)})`)
    pairs = eq.pairs
  } else {
    // every one-to-one assignment of the fewer lines into the more; the best, and the runner-up's total
    const fewBill = n < m
    const k = Math.min(n, m), big = Math.max(n, m)
    let best = -Infinity, second = -Infinity, bestPick: number[] = []
    const pick: number[] = []
    const used = new Array<boolean>(big).fill(false)
    const walk = (d: number): void => {
      if (d === k) {
        const tot = pick.reduce((s, b, a) => s + (fewBill ? S[a]![b]! : S[b]![a]!), 0)
        if (tot > best) { second = best; best = tot; bestPick = [...pick] } else if (tot > second) second = tot
        return
      }
      for (let b = 0; b < big; b++) { if (used[b]) continue; used[b] = true; pick.push(b); walk(d + 1); pick.pop(); used[b] = false }
    }
    walk(0)
    const margin = second === -Infinity ? Infinity : best - second
    if (margin < 0.25) return none(`two different line matchings are nearly as plausible (margin ${margin.toFixed(2)})`)
    pairs = bestPick.map((b, a) => (fewBill ? [a, b] : [b, a]) as [number, number])
  }
  const out: LineMatch070 = { pairs: [], unmatched: [], unbilled: [], problem: null }
  const billed = new Set<number>()
  for (const [i, j] of [...pairs].sort((x, y) => x[0] - y[0])) {
    const s = S[i]![j]!
    if (s >= 0.34 && lineNamesItem(inv[i]!.name, po[j]!.name)) { out.pairs.push([i, j]); billed.add(j); continue }
    out.unmatched.push({ i, nearest: j, why: lineNamesItem(inv[i]!.name, po[j]!.name) ? 'weak' : 'item', item: headNoun(po[j]!.name), score: Math.round(s * 100) / 100 })
  }
  for (let i = 0; i < n; i++) if (!pairs.some(([a]) => a === i)) out.unmatched.push({ i, nearest: null, why: 'extra', item: null, score: null })
  out.unmatched.sort((a, b) => a.i - b.i)
  for (let j = 0; j < m; j++) if (!billed.has(j)) out.unbilled.push(j)
  return out
}
