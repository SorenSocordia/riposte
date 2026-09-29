/**
 * Seeded corpus for the F3 hoist differential (test/bridge-hoist-differential.test.ts). Every case is built from one
 * mulberry32 seed, so a failure names a case index that reproduces exactly.
 *
 * It is built to reach every branch the hoist touches:
 *   - line counts 1–300 (skewed small, with a long tail), under line_items / items / lines / none;
 *   - line fields named canonically, by alternative path, by an i18n alias, by a fuzzy-only alias (charge, cost, CamelCase),
 *     or nested one level deep (only the fuzzy deep search finds them); values as numbers, money strings, junk, null;
 *   - heterogeneous descriptions (transport / fuel / crane / mileage / per diem / surcharge words), and descriptions
 *     under description / service / name / item, sometimes non-strings;
 *   - document fields canonical, aliased, i18n, missing (so the fuzzy search runs at a line index, where a line's own
 *     `reference` can become the document id), plus noise objects and arrays of assorted lengths (deepSearch reads [i]);
 *   - contract, evidence and history present and absent, junk references, financial_rules the keyword matcher hits
 *     and misses, evidence whose line tables are as long as the invoice's, small `totals.total` (the v5.11 guard);
 *   - pay-app documents under the pay-app ontology.
 * Null / undefined line items are NOT generated: that input crashes the old bridge and is F-BF1's, tested on its own.
 */

export type Json = Record<string, unknown>
export interface HoistCase {
  id: string
  ruleset: 'invoice' | 'pay-app'
  extraction: Json
  references?: { contract?: unknown; evidence?: unknown; history?: unknown }
}

export function rng(seed: number) {
  let a = seed >>> 0
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (lo: number, hi: number): number => lo + Math.floor(next() * (hi - lo + 1))
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)] as T
  const chance = (p: number): boolean => next() < p
  return { next, int, pick, chance }
}
type R = ReturnType<typeof rng>

const cents = (x: number): number => Math.round(x * 100) / 100
const WORDS = [
  'Consulting', 'Travel', 'Widget', 'Licence', 'Support', 'Materials', 'Labour', 'Hosting', 'Training', 'Service call',
  'Freight haul', 'Transport to site', 'Delivery', 'Fuel surcharge', 'Diesel', 'Crane rigging', 'Mobilization', 'Lift',
  'Excess mileage', 'Per diem', 'Overnight lodging', 'Standby time', 'Wait time', 'Admin fee', 'Equipment rental',
  'Water haul', 'Vacuum truck', 'Pump service', 'Overtime labor', 'Weekend crew', 'Permit oversize', 'Pilot car escort',
]
const RULE_NAMES = [
  'Hourly labor rate', 'Transport rate', 'Fuel surcharge (index)', 'Mileage over 100 miles', 'Per diem lodging',
  'Standby / detention', 'Crane and rigging', 'Equipment rental', 'Admin processing', 'Water hauling', 'Pump truck',
  'Minimum charge', 'Overtime after hours', 'Pilot escort', 'Heavy haul specialized',
]

function money(r: R, x: number): unknown {
  const k = r.int(0, 19)
  if (k < 13) return x
  if (k < 15) return x.toFixed(2)
  if (k === 15) return `$${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  if (k === 16) return `${x.toFixed(2).replace('.', ',')} EUR`
  if (k === 17) return 'n/a'
  if (k === 18) return null
  return { value: x }
}

function description(r: R): unknown {
  const k = r.int(0, 39)
  if (k === 0) return r.int(1, 99)
  if (k === 1) return ''
  return `${r.pick(WORDS)} ${r.int(1, 9)}`
}

type LineStyle = 'canonical' | 'alt' | 'i18n' | 'fuzzy' | 'nested' | 'mixed'

function line(r: R, style: LineStyle, i: number): unknown {
  if (r.chance(0.004)) return r.pick([5, 'free text line', true, [1, 2]])
  const qty = r.int(1, 40)
  const price = cents(r.int(100, 250000) / 100)
  const amount = r.chance(0.05) ? cents(qty * price + r.pick([0.01, 25, -3])) : cents(qty * price)
  const s: LineStyle = style === 'mixed' ? r.pick(['canonical', 'alt', 'i18n', 'fuzzy', 'nested'] as const) : style
  const d = description(r)
  const descKey = r.pick(['description', 'description', 'description', 'service', 'name', 'item'])
  const out: Json = {}
  if (s === 'canonical') Object.assign(out, { [descKey]: d, quantity: qty, unit_price: money(r, price), amount: money(r, amount) })
  else if (s === 'alt') Object.assign(out, { [descKey]: d, qty, rate: money(r, price), total: money(r, amount) })
  else if (s === 'i18n') Object.assign(out, { descripcion: d, cantidad: qty, precio_unitario: money(r, price), importe: money(r, amount) })
  else if (s === 'fuzzy') Object.assign(out, { [descKey]: d, Units: qty, 'Unit-Cost': price, charge: amount })
  else Object.assign(out, { [descKey]: d, pricing: { rate: price, extended: { line_total: amount } }, counts: { qty } })
  if (r.chance(0.08)) delete out[r.pick(Object.keys(out))]
  if (r.chance(0.05)) out.reference = `REF-${i}`
  if (r.chance(0.03)) out.service_date = `2026-0${r.int(1, 9)}-1${r.int(0, 9)}`
  if (r.chance(0.03)) out.hours = r.int(1, 12)
  return out
}

function lineCount(r: R): number {
  const k = r.next()
  if (k < 0.5) return r.int(1, 5)
  if (k < 0.85) return r.int(6, 40)
  if (k < 0.95) return r.int(41, 120)
  return r.int(121, 300)
}

function shuffleKeys(r: R, o: Json): Json {
  const keys = Object.keys(o)
  for (let i = keys.length - 1; i > 0; i--) {
    const j = r.int(0, i)
    ;[keys[i], keys[j]] = [keys[j] as string, keys[i] as string]
  }
  const out: Json = {}
  for (const k of keys) out[k] = o[k]
  return out
}

function invoiceExtraction(r: R, idx: number): Json {
  const n = lineCount(r)
  const style = r.pick(['canonical', 'canonical', 'canonical', 'alt', 'i18n', 'fuzzy', 'nested', 'mixed'] as const)
  const lines = Array.from({ length: n }, (_, i) => line(r, style, i))
  const sum = cents(lines.reduce<number>((s, l) => {
    const o = l as Json
    const a = o && typeof o === 'object' ? (o.amount ?? o.total ?? o.importe ?? o.charge) : 0
    return s + (typeof a === 'number' ? a : 0)
  }, 0))
  const taxRate = r.pick([0, 0.05, 0.0825, 0.1, 0.2])
  const tax = cents(sum * taxRate)
  const inv: Json = {}
  const lineKey = r.pick(['line_items', 'line_items', 'line_items', 'line_items', 'line_items', 'line_items', 'items', 'lines', ''])
  if (lineKey) inv[lineKey] = lines

  // document id
  const idStyle = r.int(0, 7)
  const id = `INV-${idx}-${r.int(1000, 9999)}`
  if (idStyle === 0 || idStyle === 1) inv.invoice_number = id
  else if (idStyle === 2) inv.document_number = id
  else if (idStyle === 3) inv.id = id
  else if (idStyle === 4) inv.header = { invoice_number: id, vendor: { name: 'Acme', reference: 'V-1' } }
  else if (idStyle === 5) inv.invoice_no = id
  // 6, 7: no id at all → the document id is searched fuzzily at each line index

  // totals
  const tStyle = r.int(0, 5)
  const total = cents(sum + tax)
  if (tStyle <= 1) inv.totals = { subtotal: money(r, sum), tax_rate: taxRate, tax: money(r, tax), total: money(r, total) }
  else if (tStyle === 2) Object.assign(inv, { subtotal: sum, tax_amount: tax, tax_rate: `${(taxRate * 100).toFixed(2)}%`, grand_total: total })
  else if (tStyle === 3) inv.totals = { zwischensumme: sum, mwst: tax, gesamtbetrag: total }
  else if (tStyle === 4) inv.amounts = { summary: { subtotal: sum, total } }
  if (r.chance(0.15)) inv.discount = r.int(0, 50)
  if (r.chance(0.1)) inv.service_charge = r.int(0, 30)

  // dates
  const dStyle = r.int(0, 6)
  if (dStyle === 0) inv.invoice_date = '2026-09-15'
  else if (dStyle === 1) inv.service_date = '09/12/2026'
  else if (dStyle === 2) inv.dates = [{ type: 'invoice_date', value: '2026-09-15' }, { type: 'service_date', value: '2026-09-10' }]
  else if (dStyle === 3) inv.dates = [{ date: '2026-08-01' }]
  else if (dStyle === 4) inv.dates = Array.from({ length: r.int(1, 4) }, (_, i) => ({ value: i === 0 ? null : `2026-07-0${i}` }))
  // 5, 6: no date → EVENT_DATE falls back to dates[*] / the fuzzy search at each line index

  if (r.chance(0.7)) inv[r.pick(['currency', 'currency_code', 'moneda'])] = r.pick(['USD', 'EUR', 'usd', 7])
  if (r.chance(0.15)) inv.prior_invoice_ids = [`INV-${idx - 1}`, `INV-${idx - 2}`]
  // noise the deep search walks through
  if (r.chance(0.3)) inv.vendor = { name: 'Vendor', address: { line1: '1 Main', ref: 'ADDR' }, contact: { price: 'call' } }
  if (r.chance(0.3)) inv.payments = Array.from({ length: r.int(0, 6) }, (_, i) => ({ amount: i * 10, reference: `PAY-${i}` }))
  if (r.chance(0.1)) inv.notes = ['net 30', { memo: 'thanks', total: 'see above' }]
  return r.chance(0.25) ? shuffleKeys(r, inv) : inv
}

function contract(r: R): unknown {
  const k = r.next()
  if (k < 0.35) return undefined
  if (k < 0.4) return r.pick([null, [], 'contract', 12, {}])
  const c: Json = {}
  const form = r.int(0, 4)
  const rules = Array.from({ length: r.int(1, 6) }, () => {
    const rule: Json = { rule_name: r.pick(RULE_NAMES), values: { rate: cents(r.int(100, 20000) / 100) } }
    if (r.chance(0.3)) rule.description = r.pick(RULE_NAMES)
    if (r.chance(0.2)) (rule.values as Json).max_amount = r.int(1000, 900000)
    if (r.chance(0.1)) { delete rule.rule_name; rule.name = r.pick(RULE_NAMES) }
    return rule
  })
  if (form <= 1) c.financial_rules = rules
  else if (form === 2) c.rates = rules.map(x => ({ rate: (x.values as Json).rate, description: x.rule_name }))
  else if (form === 3) c.rate = cents(r.int(100, 20000) / 100)
  else c.key_terms = { effective_date: '2026-01-01', expiration_date: '2026-12-31', unit_price: r.int(1, 999) }
  if (r.chance(0.5)) c[r.pick(['max_amount', 'not_to_exceed', 'po_total'])] = r.int(1000, 900000)
  if (r.chance(0.5)) Object.assign(c, { effective_date: '2026-01-01', expiration_date: r.pick(['2026-12-31', '2026-06-30']) })
  if (r.chance(0.1)) c.limits = { max: r.int(100, 9999) }
  return c
}

function evidenceDoc(r: R, invoiceLines: number): Json {
  const ev: Json = {}
  const form = r.int(0, 5)
  const n = r.chance(0.2) ? invoiceLines : r.int(1, 5)
  if (form <= 2) {
    ev.line_items = Array.from({ length: n }, () => ({
      [r.pick(['quantity', 'qty', 'hours'])]: r.int(1, 40),
      [r.pick(['description', 'service', 'name'])]: `${r.pick(WORDS)} ${r.int(1, 9)}`,
    }))
  } else if (form === 3) {
    ev.quantity = r.int(1, 40)
    ev.description = `${r.pick(WORDS)} delivered`
  } else if (form === 4) {
    ev.details = { received: { qty: r.int(1, 40) }, note: r.pick(WORDS) }
  }
  if (r.chance(0.4)) ev.totals = { total: r.pick([8, 12.5, 99, 1500, 42000]), hours: r.int(1, 12) }
  if (r.chance(0.3)) ev.ticket_number = `T-${r.int(100, 999)}`
  if (r.chance(0.3)) ev[r.pick(['date', 'delivery_date', 'ticket_date'])] = '2026-09-11'
  if (r.chance(0.2)) ev.dates = [{ type: 'service', date: '2026-09-09' }]
  return ev
}

function evidence(r: R, invoiceLines: number): unknown {
  const k = r.next()
  if (k < 0.35) return undefined
  if (k < 0.4) return r.pick([[], null, 'ticket', [null, 3]])
  return Array.from({ length: k < 0.75 ? 1 : r.int(2, 4) }, () => evidenceDoc(r, invoiceLines))
}

function history(r: R, idx: number): unknown {
  const k = r.next()
  if (k < 0.6) return undefined
  if (k < 0.65) return []
  return Array.from({ length: r.int(1, 3) }, (_, j) => ({
    invoice_number: r.chance(0.3) ? `INV-${idx}` : `INV-OLD-${j}`,
    totals: { total: r.int(10, 5000) },
    line_items: [{ description: r.pick(WORDS), quantity: 1, unit_price: 10, amount: 10 }],
  }))
}

const PA_LINE: Record<string, string[]> = {
  item: ['item_no', 'item_number', 'line_no', 'cost_code'],
  desc: ['description', 'description_of_work', 'scope', 'Description'],
  sched: ['scheduled_value', 'scheduled_amount', 'value', 'budget'],
  prev: ['previous', 'from_previous_application', 'prior'],
  cur: ['this_period', 'work_completed_this_period', 'current'],
  stored: ['materials_stored', 'stored'],
  done: ['completed_to_date', 'total_completed_and_stored', 'total_to_date'],
  pct: ['percent_complete', 'pct', 'percentage'],
  bal: ['balance_to_finish', 'balance', 'remaining'],
  ret: ['retainage', 'retention'],
}

function payApp(r: R, idx: number): Json {
  const n = lineCount(r)
  const lines = Array.from({ length: n }, (_, i) => {
    const sched = r.int(1000, 90000)
    const prev = r.int(0, Math.floor(sched / 2))
    const cur = r.int(0, Math.floor((sched - prev) / 2))
    const stored = r.chance(0.2) ? r.int(0, 500) : 0
    const done = prev + cur + stored + (r.chance(0.05) ? 7 : 0)
    const o: Json = {}
    o[r.pick(PA_LINE.item!)] = String(i + 1)
    o[r.pick(PA_LINE.desc!)] = `${r.pick(WORDS)} ${i + 1}`
    o[r.pick(PA_LINE.sched!)] = sched
    o[r.pick(PA_LINE.prev!)] = prev
    o[r.pick(PA_LINE.cur!)] = cur
    if (stored) o[r.pick(PA_LINE.stored!)] = stored
    o[r.pick(PA_LINE.done!)] = done
    if (r.chance(0.7)) o[r.pick(PA_LINE.pct!)] = r.pick([cents(done / sched), `${((done / sched) * 100).toFixed(1)}%`])
    o[r.pick(PA_LINE.bal!)] = sched - done
    if (r.chance(0.6)) o[r.pick(PA_LINE.ret!)] = cents(done * 0.1)
    return o
  })
  const key = r.pick(['schedule_of_values', 'continuation_sheet', 'line_items', 'items', 'sov'])
  const sched = lines.reduce<number>((s, l) => s + Number(Object.values(l)[2] ?? 0), 0)
  const summary: Json = {
    application_number: String(idx), original_contract_sum: sched, net_change_orders: 0, contract_sum_to_date: sched,
    retainage_rate: r.pick([0.1, '10%', 0.05]), current_payment_due: r.int(100, 90000),
  }
  const where = r.int(0, 2)
  const app: Json = { [key]: lines }
  if (where === 0) Object.assign(app, summary)
  else app[r.pick(['summary', 'g702', 'application'])] = summary
  return app
}

export function buildHoistCorpus(count: number, seed = 20260928): HoistCase[] {
  const r = rng(seed)
  const out: HoistCase[] = []
  for (let idx = 0; idx < count; idx++) {
    if (r.chance(0.12)) {
      const app = payApp(r, idx)
      out.push({ id: `pa-${idx}`, ruleset: 'pay-app', extraction: app, references: r.chance(0.4) ? { history: [payApp(r, idx)] } : undefined })
      continue
    }
    const extraction = invoiceExtraction(r, idx)
    const lines = Array.isArray(extraction.line_items) ? extraction.line_items.length : 0
    const refs = { contract: contract(r), evidence: evidence(r, lines), history: history(r, idx) }
    out.push({ id: `inv-${idx}`, ruleset: 'invoice', extraction, references: refs })
  }
  return out
}

/** A random LLM correlation map (the bridge-level API accepts one; verify() never passes it). */
export function randomCorrelationMap(r: R, lines: number): unknown {
  if (r.chance(0.2)) return { lineItemMappings: [] }
  const conf = ['HIGH', 'MEDIUM', 'LOW'] as const
  return {
    lineItemMappings: Array.from({ length: r.int(1, Math.max(1, Math.min(lines, 8))) }, () => ({
      invoiceLineIndex: r.int(0, Math.max(0, lines - 1)),
      invoiceLineDescription: r.pick(WORDS),
      matchedEvidence: r.chance(0.6)
        ? [{ evidenceDocIndex: r.int(-1, 2), confidence: r.pick(conf), reasoning: 'seeded', ticketNumber: r.chance(0.5) ? 'T-1' : undefined }]
        : [],
      matchedContractRule: r.chance(0.7) ? { ruleName: r.pick(RULE_NAMES), ruleIndex: r.int(-1, 4), confidence: r.pick(conf), reasoning: 'seeded' } : undefined,
    })),
  }
}
