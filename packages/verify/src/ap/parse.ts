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
   * We do not guess whether they belong in the total — their presence makes the total check abstain. (Found by the H4
   * stress test: OCR-misspelled "Shippign and handling" was silently dropped and a good invoice was held.)
   */
  unclassified: (Located<number> & { text: string })[]
  /** a total line whose amount is written with unanchored space-grouping — ambiguous, never guessed */
  ambiguousTotal: string | null
}
export interface ParsedPo { number: Located<string> | null; freightAllowed: boolean | null; lines: PoLine[] }

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
  // before the first group — a currency sign is never followed by a quantity. (H4 stress test: "$1 555.63" was read as
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

export function parseInvoice(text: string): ParsedInvoice {
  const explicit = [...text.matchAll(/invoice\s*(?:no\.?|number|#|:)?\s*([A-Z]{2,4}-\d{4,6})\b/gi)]
  const all = [...text.matchAll(/\b([A-Z]{2,4}-\d{4,6})\b/g)].filter((m) => !/^(PO|Q|QT|QUO|REF|RMA)-/i.test(m[1]!))
  const pool = explicit.length ? explicit : all
  const candidates = [...new Set(pool.map((m) => m[1]!.toUpperCase()))]
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
  let ambiguousTotal: string | null = null
  for (const l of linesOf(text)) {
    const line = l.text.trim()
    if (!line) continue
    const nums = numbersIn(l.text)
    const unclassify = (): void => {
      if (!MONEY.test(l.text) || STRAY.test(l.text)) return
      const money = nums.filter((n) => /\.\d{2}$/.test(n.text))
      const pick = money[money.length - 1] ?? nums[nums.length - 1]
      if (pick) unclassified.push({ value: pick.value, span: spanOf(l), text: line })
    }
    if (TOTAL.test(l.text) && !NOT_TOTAL.test(l.text) && nums.length) {
      if (UNANCHORED_SPACE_GROUP.test(l.text)) { ambiguousTotal = line; continue }
      const kw = l.text.search(TOTAL)
      const money = nums.filter((n) => n.index > kw && /\.\d{2}$/.test(n.text))
      totals.push({ value: (money[0] ?? nums[nums.length - 1]!).value, span: spanOf(l) })
      continue
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
  return { invoiceNumber, invoiceNumberCandidates: candidates, poNumbers, lines, totals, freight, unclassified, ambiguousTotal }
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
  return { number, freightAllowed, lines }
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

function tokens(s: string): string[] {
  return s.toLowerCase()
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

export function nameScore(invName: string, poName: string): number {
  const a = tokens(invName).filter((t) => !STOP.has(t))
  const b = tokens(poName).filter((t) => !STOP.has(t))
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
export function matchLines(inv: InvoiceLine[], po: PoLine[]): LineMatch | null {
  const n = inv.length
  if (n !== po.length || n === 0 || n > 8) return null
  const S = inv.map((il) => po.map((pl) => nameScore(il.name, pl.name) +
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
