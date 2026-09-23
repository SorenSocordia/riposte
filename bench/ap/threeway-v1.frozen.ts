/**
 * Deterministic AP three-way match: invoice email ↔ purchase order ↔ goods receipt, with honest abstention.
 *
 * Policy (Distil Labs' published step-2 policy, in order, stop at first failure):
 *   1. invoice's PO number === the PO's number                      -> hold_no_po
 *   2. no line bills more units than were received                  -> hold_quantity
 *   3. no unit price > PO price × 1.02                              -> hold_price
 *   4. stated total === Σ line totals (+ freight only if allowed)   -> hold_total
 *   otherwise approve.
 *
 * Design rule: NEVER GUESS. Anything the parser or matcher is not sure of returns ABSTAIN with the reason — a human looks.
 * Written from the README's documented examples + one case (see PREREG.md); frozen before the benchmark run.
 */

export type Decision = 'approve' | 'hold_no_po' | 'hold_quantity' | 'hold_price' | 'hold_total'

export interface InvoiceLine { raw: string; name: string; qty: number; unit: number; amount: number; amountMismatch: boolean }
export interface PoLine { index: number; name: string; qty: number; unit: number }
export interface ReceiptLine { index: number; name: string; received: number }

export interface ApResult {
  outcome: 'DECIDED' | 'ABSTAIN'
  decision?: Decision
  invoice_number?: string | null
  po_number?: string | null
  item?: string | null
  invoiced?: string | number | null
  expected?: string | number | null
  reasons: string[]
  /** the work, for the receipt: every check that ran and what it saw */
  trace: string[]
}

// ---------- number + text utilities ----------

const NUM = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g

function numbersIn(s: string): { value: number; text: string; index: number }[] {
  const out: { value: number; text: string; index: number }[] = []
  for (const m of s.matchAll(NUM)) {
    const i = m.index ?? 0
    const before = s[i - 1] ?? ''
    const after = s[i + m[0].length] ?? ''
    // part of an identifier like PO-49051, AJ-97466, Q-2776, or a date 2026-09-28 -> not an amount
    if (before === '-' || after === '-') continue
    // glued to letters (14OZ, 50FT, 12AWG, 300MM, 50P) -> a spec inside a name, not an amount
    if (/[A-Za-z]/.test(after) || /[A-Za-z]/.test(before)) continue
    out.push({ value: Number(m[0].replace(/,/g, '')), text: m[0], index: i })
  }
  return out
}

const close = (a: number, b: number, eps = 0.005): boolean => Math.abs(a - b) <= eps
const round2 = (x: number): number => Math.round(x * 100) / 100

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/[^a-z0-9. ]+/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/\.$/, ''))
    .filter(Boolean)
}

/** abbreviation-aware token match: equal, prefix (cart~cartridge), or ordered-subsequence with same first letter (rl~roll). */
function tokenMatch(a: string, b: string): boolean {
  if (a === b) return true
  if (/^\d/.test(a) || /^\d/.test(b)) return false // numbers must match exactly
  const [s, l] = a.length <= b.length ? [a, b] : [b, a]
  if (s.length < 2) return false
  if (l.startsWith(s)) return true
  if (s[0] !== l[0]) return false
  let j = 0
  for (const ch of l) if (ch === s[j]) j++
  return j === s.length && s.length >= 2
}

const STOP = new Set(['x', 'usd', 'ea', 'each', 'pc', 'pcs', 'unit', 'units', 'of', 'the', 'and', 'with', 'for', 'a'])

function nameScore(invName: string, poName: string): number {
  const a = tokens(invName).filter((t) => !STOP.has(t))
  const b = tokens(poName).filter((t) => !STOP.has(t))
  if (!a.length || !b.length) return 0
  const used = new Set<number>()
  let hit = 0
  for (const t of a) {
    const j = b.findIndex((u, k) => !used.has(k) && tokenMatch(t, u))
    if (j >= 0) { used.add(j); hit++ }
  }
  // numeric spec tokens that disagree are strong negative evidence (50 ft vs 25 ft)
  const numsA = a.filter((t) => /^\d/.test(t))
  const numsB = new Set(b.filter((t) => /^\d/.test(t)))
  const numMiss = numsA.filter((t) => !numsB.has(t)).length
  return hit / Math.min(a.length, b.length) - 0.5 * numMiss
}

// ---------- parsing ----------

function sections(input: string): { invoice: string; po: string; receipt: string } | null {
  const iPo = input.indexOf('PURCHASE ORDER (ERP)')
  const iGr = input.indexOf('GOODS RECEIPT (ERP)')
  if (iPo < 0 || iGr < 0 || iGr < iPo) return null
  return { invoice: input.slice(0, iPo), po: input.slice(iPo, iGr), receipt: input.slice(iGr) }
}

function parsePo(po: string): { number: string | null; freightAllowed: boolean | null; lines: PoLine[] } {
  const number = po.match(/\b(PO-\d+)\s*\|\s*Vendor/)?.[1] ?? null
  const fr = po.match(/Freight:\s*(not allowed|allowed)/i)?.[1]?.toLowerCase()
  const lines: PoLine[] = []
  for (const m of po.matchAll(/^\s*(\d+)\.\s*(.+?)\s*\|\s*qty\s*([\d,.]+)\s*\|\s*unit\s*[A-Z]{3}\s*([\d,.]+)\s*$/gm)) {
    lines.push({ index: Number(m[1]), name: m[2]!.trim(), qty: Number(m[3]!.replace(/,/g, '')), unit: Number(m[4]!.replace(/,/g, '')) })
  }
  return { number, freightAllowed: fr === undefined ? null : fr === 'allowed', lines }
}

function parseReceipt(gr: string): ReceiptLine[] {
  const out: ReceiptLine[] = []
  for (const m of gr.matchAll(/^\s*(\d+)\.\s*(.+?)\s*\|\s*received\s*([\d,.]+)\s*$/gm)) {
    out.push({ index: Number(m[1]), name: m[2]!.trim(), received: Number(m[3]!.replace(/,/g, '')) })
  }
  return out
}

const NOT_TOTAL = /sub-?\s*total|previous|balance|quote|valid|credit|paid|deposit|outstanding|overdue|last month|prior/i
const FREIGHT = /freight|shipping|delivery charge|carriage/i

interface ParsedInvoice {
  invoiceNumber: string | null
  invoiceNumberCandidates: string[]
  poNumbers: string[]
  lines: InvoiceLine[]
  totals: number[]
  freight: number[]
}

function parseInvoice(inv: string): ParsedInvoice {
  const body = inv.replace(/^INVOICE MESSAGE\s*/m, '')
  // invoice number: prefer an explicit "invoice <ID>" mention; IDs look like AB-12345
  const idRe = /\b([A-Z]{2,4}-\d{4,6})\b/g
  const explicit = [...body.matchAll(/invoice\s*(?:no\.?|number|#|:)?\s*([A-Z]{2,4}-\d{4,6})\b/gi)].map((m) => m[1]!.toUpperCase())
  const allIds = [...body.matchAll(idRe)].map((m) => m[1]!).filter((id) => !/^(PO|Q|QT|QUO|REF|RMA)-/i.test(id))
  const candidates = [...new Set(explicit.length ? explicit : allIds)]
  const poNumbers = [...new Set([...body.matchAll(/\b(PO-\d+)\b/g)].map((m) => m[1]!))]

  const lines: InvoiceLine[] = []
  const totals: number[] = []
  const freight: number[] = []
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const nums = numbersIn(line)
    if (/total/i.test(line) && !NOT_TOTAL.test(line) && nums.length) { totals.push(nums[nums.length - 1]!.value); continue }
    if (FREIGHT.test(line) && nums.length && !/not allowed|no freight/i.test(line)) { freight.push(nums[nums.length - 1]!.value); continue }
    if (nums.length < 3) continue
    // a line item is a (qty, unit, amount) triple in order with qty an integer; prefer exact qty*unit == amount
    type Pick = { q: number; u: number; t: number; exact: boolean; idx: [number, number, number] }
    let best: Pick | null = null
    for (let i = 0; i < nums.length; i++) for (let j = i + 1; j < nums.length; j++) for (let k = j + 1; k < nums.length; k++) {
      const q = nums[i]!.value, u = nums[j]!.value, t = nums[k]!.value
      if (!Number.isInteger(q) || q <= 0 || u <= 0) continue
      const exact = close(round2(q * u), t, 0.011)
      if (exact && (!best || k > best.idx[2])) best = { q, u, t, exact, idx: [i, j, k] }
    }
    if (!best && nums.length >= 3) {
      // fall back to the last three numbers when they read as qty · unit · amount but the amount is off (a real billing error)
      const n = nums.length
      const [a, b, c] = [nums[n - 3]!, nums[n - 2]!, nums[n - 1]!]
      if (Number.isInteger(a.value) && a.value > 0 && Math.abs(a.value * b.value - c.value) / Math.max(c.value, 1) < 0.25) {
        best = { q: a.value, u: b.value, t: c.value, exact: false, idx: [n - 3, n - 2, n - 1] }
      }
    }
    if (!best) continue
    // item name = the line with the three amount numbers (and a leading row index) blanked out; spec numbers stay
    let named = line
    for (const k of [...best.idx].sort((x, y) => y - x)) {
      const nm = nums[k]!
      named = named.slice(0, nm.index) + ' '.repeat(nm.text.length) + named.slice(nm.index + nm.text.length)
    }
    const name = named
      .replace(/^\s*[-*•]?\s*\d{1,2}[.)]?\s+(?=\S)/, (m) => (/^\s*[-*•]?\s*\d{1,2}[.)]?\s+$/.test(m) && best!.idx[0] !== 0 ? ' ' : m))
      .replace(/\b(USD|EUR|GBP|CAD)\b|\$/gi, ' ')
      .replace(/[|@=×]|\bx\b/gi, ' ')
      .replace(/^[\s\-*•]+/, '')
      .replace(/\s+/g, ' ')
      .trim()
    lines.push({ raw: line, name, qty: best.q, unit: best.u, amount: best.t, amountMismatch: !best.exact })
  }
  return { invoiceNumber: candidates.length === 1 ? candidates[0]! : null, invoiceNumberCandidates: candidates, poNumbers, lines, totals, freight }
}

// ---------- matching ----------

function assign(inv: InvoiceLine[], po: PoLine[]): { pairs: [number, number][]; margin: number; minScore: number } | null {
  const n = inv.length
  if (n !== po.length || n === 0 || n > 8) return null
  const score = (i: number, j: number): number => {
    const s = nameScore(inv[i]!.name, po[j]!.name)
    const priceBonus = close(inv[i]!.unit, po[j]!.unit, 0.005) ? 0.3 : Math.abs(inv[i]!.unit - po[j]!.unit) / po[j]!.unit < 0.12 ? 0.1 : 0
    return s + priceBonus
  }
  const S = inv.map((_, i) => po.map((_, j) => score(i, j)))
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
  const minScore = Math.min(...pairs.map(([i, j]) => S[i]![j]!))
  return { pairs, margin: n === 1 ? Infinity : best - second, minScore }
}

// ---------- the policy ----------

export function checkInvoice(input: string): ApResult {
  const trace: string[] = []
  const abstain = (why: string): ApResult => ({ outcome: 'ABSTAIN', reasons: [why], trace })
  const sec = sections(input)
  if (!sec) return abstain('could not find the ERP purchase order / goods receipt blocks')
  const po = parsePo(sec.po)
  const gr = parseReceipt(sec.receipt)
  const inv = parseInvoice(sec.invoice)
  if (!po.number || !po.lines.length) return abstain('purchase order could not be read')
  if (!inv.invoiceNumber) return abstain(`invoice number unclear (${inv.invoiceNumberCandidates.join(', ') || 'none found'})`)
  const base = { invoice_number: inv.invoiceNumber }

  // Check 1 — PO number
  if (inv.poNumbers.length > 1) return abstain(`invoice mentions several PO numbers (${inv.poNumbers.join(', ')})`)
  const invPo = inv.poNumbers[0] ?? null
  trace.push(`Check 1: invoice says ${invPo ?? 'no PO'}, PO is ${po.number}.`)
  if (invPo !== po.number) {
    return { outcome: 'DECIDED', decision: 'hold_no_po', ...base, po_number: invPo, item: null, invoiced: invPo, expected: po.number, reasons: ['PO number on the invoice does not match the purchase order'], trace }
  }

  // Lines + matching (needed for checks 2 and 3)
  if (inv.lines.length !== po.lines.length) return abstain(`read ${inv.lines.length} invoice line(s) but the PO has ${po.lines.length}`)
  const a = assign(inv.lines, po.lines)
  if (!a) return abstain('could not match invoice lines to PO lines')
  if (a.minScore < 0.34) return abstain(`a line match is too weak to trust (score ${a.minScore.toFixed(2)})`)
  if (a.margin < 0.25) return abstain(`two different line matchings are nearly as plausible (margin ${a.margin.toFixed(2)})`)
  const byPo = new Map<number, InvoiceLine>()
  for (const [i, j] of a.pairs) byPo.set(j, inv.lines[i]!)
  for (const [j, l] of [...byPo].sort((x, y) => x[0] - y[0])) trace.push(`match: "${l.name}" -> PO L${po.lines[j]!.index} "${po.lines[j]!.name}"`)

  // Check 2 — quantity vs received, in PO line order
  trace.push('Check 2 (invoiced <= received):')
  for (let j = 0; j < po.lines.length; j++) {
    const pl = po.lines[j]!
    const rl = gr.find((r) => r.index === pl.index)
    if (!rl) return abstain(`no goods-receipt line for PO line ${pl.index}`)
    const il = byPo.get(j)!
    const ok = il.qty <= rl.received
    trace.push(`L${pl.index} ${pl.name}: ${il.qty} vs ${rl.received} ${ok ? 'ok' : 'FAIL'}`)
    if (!ok) return { outcome: 'DECIDED', decision: 'hold_quantity', ...base, po_number: invPo, item: pl.name, invoiced: il.qty, expected: rl.received, reasons: [`billed ${il.qty}, received ${rl.received}`], trace }
  }

  // Check 3 — unit price vs PO price × 1.02, in PO line order
  trace.push('Check 3 (price <= PO price x 1.02):')
  for (let j = 0; j < po.lines.length; j++) {
    const pl = po.lines[j]!
    const il = byPo.get(j)!
    const max = pl.unit * 1.02
    const ok = il.unit <= max + 1e-9
    trace.push(`L${pl.index}: PO ${pl.unit.toFixed(2)}, max ${max.toFixed(4)}, invoiced ${il.unit.toFixed(2)} ${ok ? 'ok' : 'FAIL'}`)
    if (!ok) return { outcome: 'DECIDED', decision: 'hold_price', ...base, po_number: invPo, item: pl.name, invoiced: il.unit, expected: pl.unit, reasons: [`unit price ${il.unit} exceeds ${pl.unit} × 1.02`], trace }
  }

  // Check 4 — stated total vs Σ line totals (+ freight iff allowed)
  const totals = [...new Set(inv.totals.map(round2))]
  if (totals.length !== 1) return abstain(totals.length ? `several different stated totals (${totals.join(', ')})` : 'no stated total found')
  if (inv.freight.length > 1) return abstain('several freight amounts')
  if (inv.freight.length && po.freightAllowed === null) return abstain('freight billed but the PO does not say whether freight is allowed')
  const freight = inv.freight.length && po.freightAllowed ? inv.freight[0]! : 0
  const sum = round2(inv.lines.reduce((s, l) => s + l.amount, 0) + freight)
  const stated = totals[0]!
  trace.push(`Check 4: stated ${stated.toFixed(2)}, lines ${sum.toFixed(2)}${inv.freight.length ? ` (freight ${inv.freight[0]} ${po.freightAllowed ? 'included' : 'excluded: not allowed'})` : ''}`)
  if (!close(stated, sum, 0.005)) {
    return { outcome: 'DECIDED', decision: 'hold_total', ...base, po_number: invPo, item: null, invoiced: stated, expected: sum, reasons: [`stated total ${stated} ≠ ${sum}`], trace }
  }
  trace.push('Decision: approve')
  return { outcome: 'DECIDED', decision: 'approve', ...base, po_number: invPo, item: null, invoiced: null, expected: null, reasons: ['all four checks passed'], trace }
}
