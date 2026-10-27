/**
 * action@0.2.0 under seeded fuzz and property tests (pre-registration sha256 eab18209…, bars B1–B4; every generator here is
 * ours and synthetic). The bars were written before any run: 0 false FAILs on clean calls in every admitted form (B1, B2),
 * and 0 changed values accepted as equivalent (B3): scale, sign, another record's value, a leading zero, an ambiguous or
 * wrongly ordered date, a wrong or undeclared currency, percent against fraction, a comma as a decimal mark. The exact case
 * counts below are determinism pins (the generators are seeded), not bars.
 */
import { describe, it, expect } from 'vitest'
import { verifyAction, type ActionSources, type ProposedAction } from '../src/index'
import { compareValues, CURRENCY_SYMBOLS, type Comparison } from '../src/action/equivalence'
import type { Scalar } from '../src/verdict/schema'

const NOW = { now: () => new Date('2026-09-29T12:00:00Z') }
const LONG = { timeout: 180_000 }

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
class G {
  private r: () => number
  constructor(seed: number) { this.r = rng(seed) }
  int(lo: number, hi: number): number { return lo + Math.floor(this.r() * (hi - lo + 1)) }
  pick<T>(xs: readonly T[]): T { return xs[Math.floor(this.r() * xs.length)]! }
  bool(p = 0.5): boolean { return this.r() < p }
  digits(k: number): string { return Array.from({ length: k }, () => String(this.int(0, 9))).join('') }
}

// ── exact decimals as (units, scale): value = units × 10^-scale ─────────────────────────────────────────────────────
interface D { units: number; scale: number }
const shift = (d: D, k: number): D => (d.scale - k >= 0 ? { units: d.units, scale: d.scale - k } : { units: d.units * 10 ** (k - d.scale), scale: 0 })
function parts(d: D): { neg: boolean; int: string; frac: string } {
  const s = String(Math.abs(d.units)).padStart(d.scale + 1, '0')
  return { neg: d.units < 0, int: s.slice(0, s.length - d.scale), frac: s.slice(s.length - d.scale).replace(/0+$/, '') }
}
const canonical = (d: D): string => { const p = parts(d); return `${p.neg ? '-' : ''}${p.int}${p.frac ? `.${p.frac}` : ''}` }
const group = (int: string): string => int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
const pad2 = (n: number): string => String(n).padStart(2, '0')
/** The JSON number for d, when its shortest form is exactly d (at most 15 significant digits); else undefined. */
const asNumber = (d: D): number | undefined => { const n = Number(canonical(d)); return String(n) === canonical(d) ? n : undefined }
/** A plain numeral for d with 0–3 trailing fractional zeros added. */
function numeralOf(d: D, g: G): string {
  const p = parts(d)
  const zeros = g.pick(['', '', '0', '00', '000'])
  const frac = p.frac + zeros
  return `${p.neg ? '-' : ''}${p.int}${frac ? `.${frac}` : ''}`
}
/** Any form of d the undeclared comparison can match against a JSON number: the number itself, or a numeral. */
function undeclaredForm(d: D, g: G): Scalar { const n = asNumber(d); return n !== undefined && g.bool(0.4) ? n : numeralOf(d, g) }

const SYMBOLS_FOR = (c: string): string[] => Object.entries(CURRENCY_SYMBOLS).filter(([, cs]) => cs.includes(c)).map(([s]) => s)
const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'JPY', 'INR', 'BRL', 'CHF', 'AUD'] as const
/** Any form the amount comparison reads as d (in currency c when given). */
function amountForm(d: D, g: G, currency?: string): Scalar {
  const n = asNumber(d)
  if (n !== undefined && g.bool(0.2)) return n
  const p = parts(d)
  const frac = p.frac + g.pick(['', '', '0', '00'])
  const body = `${p.int.length > 3 && g.bool(0.5) ? group(p.int) : p.int}${frac ? `.${frac}` : ''}`
  let s = `${p.neg ? '-' : ''}${body}`
  if (currency && g.bool(0.7)) {
    const syms = SYMBOLS_FOR(currency)
    const where = g.pick(syms.length ? ['prefix-symbol', 'prefix-code', 'suffix-code', 'suffix-symbol'] : ['prefix-code', 'suffix-code'])
    const minusFirst = g.bool()
    const sign = p.neg ? '-' : ''
    if (where === 'prefix-symbol') { const sym = g.pick(syms); const sp = g.bool(0.3) ? ' ' : ''; s = minusFirst ? `${sign}${sym}${sp}${body}` : `${sym}${sp}${sign}${body}` }
    if (where === 'prefix-code') s = minusFirst ? `${sign}${currency} ${body}` : `${currency} ${sign}${body}`
    if (where === 'suffix-code') s = `${sign}${body} ${currency}`
    if (where === 'suffix-symbol') s = `${sign}${body}${g.bool() ? ' ' : ''}${g.pick(syms)}`
  }
  return g.bool(0.1) ? ` ${s} ` : s
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const ord = (d: number): string => (d % 10 === 1 && d !== 11 ? 'st' : d % 10 === 2 && d !== 12 ? 'nd' : d % 10 === 3 && d !== 13 ? 'rd' : 'th')
const caseMix = (s: string, g: G): string => g.pick([s, s.toLowerCase(), s.toUpperCase()])
function monthWord(m: number, g: G): string {
  const full = MONTHS[m - 1]!
  const w = g.pick(m === 9 ? ['full', 'abbrev', 'dot', 'sept'] : ['full', 'abbrev', 'dot'])
  const t = w === 'full' ? full : w === 'sept' ? 'Sept' : full.slice(0, 3)
  return caseMix(t, g) + (w === 'dot' || (w === 'sept' && g.bool()) ? '.' : '')
}
/** Any form the date comparison reads as (y, m, d), in the declared order when numeric. */
function dateForm(y: number, m: number, d: number, g: G, order?: 'DMY' | 'MDY'): string {
  const kinds = ['iso', 'iso-slash', 'd-month', 'month-d', ...(order ? ['numeric', 'numeric'] : [])]
  const k = g.pick(kinds)
  const day = `${g.bool(0.2) ? pad2(d) : d}${g.bool(0.3) ? ord(d) : ''}`
  switch (k) {
    case 'iso': return `${y}-${pad2(m)}-${pad2(d)}`
    case 'iso-slash': return `${y}/${pad2(m)}/${pad2(d)}`
    case 'd-month': return `${day} ${monthWord(m, g)}${g.bool(0.3) ? ',' : ''} ${y}`
    case 'month-d': return `${monthWord(m, g)} ${day}${g.bool(0.6) ? ',' : ''} ${y}`
    default: {
      const sep = g.pick(['/', '-', '.'])
      const dd = g.bool() ? pad2(d) : String(d), mm = g.bool() ? pad2(m) : String(m)
      return order === 'DMY' ? `${dd}${sep}${mm}${sep}${y}` : `${mm}${sep}${dd}${sep}${y}`
    }
  }
}
/** A rate k/1000 (a fraction) in any form the declared unit reads as that rate. */
function rateForm(k: number, unit: 'percent' | 'fraction', g: G): Scalar {
  const fraction: D = { units: k, scale: 3 }, percent: D = { units: k, scale: 1 }
  if (g.bool(0.4)) return `${numeralOf(percent, g)}${g.bool(0.3) ? ' ' : ''}%`
  return undeclaredForm(unit === 'fraction' ? fraction : percent, g)
}
function idForm(id: string, g: G, c: { case_insensitive?: boolean; whitespace_insensitive?: boolean }): string {
  let s = id
  if (c.case_insensitive) s = [...s].map(ch => (g.bool() ? ch.toUpperCase() : ch.toLowerCase())).join('')
  if (c.whitespace_insensitive) {
    s = g.bool(0.3) ? s.replace(/\s/g, '') : s
    if (g.bool(0.5)) { const i = g.int(0, s.length); s = `${s.slice(0, i)}${g.pick([' ', '  ', '\t'])}${s.slice(i)}` }
  }
  return s
}

// ── record groups, the way approvals share fields ─────────────────────────────────────────────────────────────────────
interface Group { records: Record<string, Scalar>[]; amounts: D[] }
function group2to7(g: G, amountAsNumber: boolean): Group {
  const n = g.int(2, 7)
  const payee = g.bool() ? `${g.digits(3)}-${g.digits(3)}-${g.digits(4)}` : undefined // one vendor with several invoices, or several payees
  const records: Record<string, Scalar>[] = [], amounts: D[] = []
  const seen = new Set<string>()
  while (records.length < n) {
    const d: D = { units: g.int(1, 99_999_999) * (g.bool(0.3) ? 10 : 1), scale: 2 }
    if (seen.has(canonical(d))) continue
    seen.add(canonical(d))
    const two = (() => { const p = parts(d); return `${p.int}.${(p.frac + '00').slice(0, 2)}` })()
    records.push({ amount: amountAsNumber ? asNumber(d)! : two, to_account: payee ?? `${g.digits(3)}-${g.digits(3)}-${g.digits(4)}`, reference: `REF-${g.digits(5)}-${records.length}` })
    amounts.push(d)
  }
  return { records, amounts }
}
const TOOLS = ['pay_invoice', 'issue_refund', 'release_tranche', 'settle_claim', 'ship_order', 'adjust_payroll', 'transfer'] as const
function sourcesFor(grp: Group, g: G): ActionSources {
  const s: ActionSources = { records: grp.records }
  if (g.bool(0.4)) s.allowed = { amount: grp.records.map(r => r.amount as string | number), to_account: grp.records.map(r => r.to_account as string) }
  if (g.bool(0.25)) s.require = ['amount']
  if (g.bool(0.3)) s.text = `Approved: ${grp.records.map(r => String(r.reference)).join(', ')}.`
  return s
}

describe('B1 the representation class: 0 false FAILs', () => {
  it('10,000 clean calls whose amount is the approved number in its other exact form, either direction', LONG, () => {
    const g = new G(1)
    let n = 0, pass = 0
    const bad: string[] = []
    while (n < 10_000) {
      const numbers = g.bool()
      const grp = group2to7(g, numbers)
      const k = g.int(0, grp.records.length - 1)
      const approved = grp.records[k]!.amount
      const other = numbers ? (() => { const p = parts(grp.amounts[k]!); return `${p.int}.${(p.frac + '00').slice(0, 2)}` })() : asNumber(grp.amounts[k]!)!
      if (String(other) === String(approved)) continue // the same as written: not this class
      n++
      const v = verifyAction({ tool: g.pick(TOOLS), arguments: { ...grp.records[k], amount: other } }, sourcesFor(grp, g), NOW)
      if (v.outcome === 'PASS' && v.ruleset.version === '0.2.0') pass++
      else if (bad.length < 5) bad.push(`${JSON.stringify(approved)} vs ${JSON.stringify(other)}: ${v.outcome} ${v.ruleset.version}`)
    }
    expect(bad).toEqual([])
    expect(pass).toBe(10_000)
  })
})

describe('B2 every frozen equivalence: 0 false FAILs', () => {
  it('10,000 clean calls, every argument written in a form its type admits (either side), under records and allow-lists', LONG, () => {
    const g = new G(2)
    const bad: string[] = []
    let pass = 0, relabelled = 0
    for (let i = 0; i < 10_000; i++) {
      const currency = g.bool(0.7) ? g.pick(CURRENCIES) : undefined
      const idFlags = { case_insensitive: g.bool(0.7), whitespace_insensitive: g.bool(0.5) }
      const order = g.pick([undefined, 'DMY', 'MDY'] as const)
      const unit = g.pick(['percent', 'fraction'] as const)
      const undeclaredAmount = g.bool(0.25)
      const fields: NonNullable<ActionSources['fields']> = {
        ...(undeclaredAmount ? {} : { amount: currency ? { type: 'amount', currency } : { type: 'amount' } }),
        reference: { type: 'identifier', ...idFlags }, due: { type: 'date', ...(order ? { order } : {}) }, rate: { type: 'rate', unit },
      }
      const n = g.int(2, 5)
      const truth = Array.from({ length: n }, (_, j) => ({
        amount: { units: g.int(-50_000_000, 99_999_999) || 1, scale: g.pick([0, 1, 2, 3]) } as D,
        reference: `${g.pick(['INV', 'Ref', 'PO', 'DE89'])}-${g.digits(4)} ${g.pick(['A', 'b', 'Cc'])}${j}`,
        date: { y: g.int(2000, 2040), m: g.int(1, 12), d: g.int(1, 28) }, rate: g.int(1, 999),
      }))
      // undeclared amounts: one side a JSON number, the other its number or numeral (the only undeclared equivalence)
      const writeAmount = (d: D, side: 'approved' | 'call'): Scalar => {
        if (!undeclaredAmount) return amountForm(d, g, currency)
        const num = asNumber(d)
        return side === 'approved' ? (num ?? canonical(d)) : (num !== undefined ? undeclaredForm(d, g) : canonical(d))
      }
      const write = (t: (typeof truth)[number], side: 'approved' | 'call'): Record<string, Scalar> => ({
        amount: writeAmount(t.amount, side), reference: idForm(t.reference, g, idFlags),
        due: dateForm(t.date.y, t.date.m, t.date.d, g, order), rate: rateForm(t.rate, unit, g),
      })
      const records = truth.map(t => write(t, 'approved'))
      const k = g.int(0, n - 1)
      const sources: ActionSources = g.bool(0.75)
        ? { records, fields, ...(g.bool(0.3) ? { allowed: { amount: records.map(r => r.amount as string | number) } } : {}) }
        : { allowed: Object.fromEntries(['amount', 'reference', 'due', 'rate'].map(f => [f, records.map(r => r[f] as string | number)])), fields }
      const v = verifyAction({ tool: g.pick(TOOLS), arguments: write(truth[k]!, 'call') }, sources, NOW)
      if (v.outcome === 'PASS') { pass++; if (v.ruleset.version === '0.2.0') relabelled++ }
      else if (bad.length < 5) bad.push(JSON.stringify({ records, call: v.claims.map(c => [c.field, c.asserted, c.outcome]), fields }))
    }
    expect(bad).toEqual([])
    expect(pass).toBe(10_000)
    expect(relabelled).toBe(9_985) // determinism pin, set after the first run: the other 15 PASS under 0.1.0 too (the label moves only with the decision)
  })
})

describe('B3 the false-PASS guard: no changed value is ever accepted as an equivalent', () => {
  /** A changed value against the approved one: never the same under the comparison, and never a PASS at the gate. */
  function guard(name: string, seed: number, make: (g: G) => { approved: Scalar; changed: Scalar; c: Comparison } | undefined): void {
    it(`${name}: 0 accepted in 10,000`, LONG, () => {
      const g = new G(seed)
      const accepted: string[] = []
      let n = 0
      while (n < 10_000) {
        const x = make(g)
        if (!x) continue
        n++
        const cmp = [compareValues(x.approved, x.changed, x.c).kind, compareValues(x.changed, x.approved, x.c).kind]
        const fields = x.c.type === 'undeclared' ? undefined : { v: x.c as NonNullable<ActionSources['fields']>[string] }
        const records = [{ v: x.approved, reference: 'R-1' }, { v: '__other__', reference: 'R-2' }]
        const gate = verifyAction({ tool: 'transfer', arguments: { v: x.changed, reference: 'R-1' } }, { records, allowed: { v: [x.approved] }, ...(fields ? { fields } : {}) }, NOW).outcome
        if (cmp.some(k => k !== 'different') || gate === 'PASS') accepted.push(`${JSON.stringify(x.approved)} vs ${JSON.stringify(x.changed)} under ${JSON.stringify(x.c)}: ${cmp.join('/')} ${gate}`)
      }
      expect(accepted.slice(0, 5)).toEqual([])
      expect(n).toBe(10_000)
    })
  }
  const amountType = (g: G): Comparison => g.pick<Comparison>([{ type: 'undeclared' }, { type: 'amount' }, { type: 'amount', currency: g.pick(CURRENCIES) }, { type: 'text' }])
  const write = (d: D, g: G, c: Comparison): Scalar => (c.type === 'amount' ? amountForm(d, g, c.currency) : undeclaredForm(d, g))
  const someAmount = (g: G): D => ({ units: g.int(1, 99_999_999) * (g.bool() ? 1 : -1), scale: g.pick([0, 1, 2, 3]) })

  guard('scale ×10^k, k = ±1, ±2, ±3, in any form', 31, g => {
    const d = someAmount(g), c = amountType(g)
    return { approved: write(d, g, c), changed: write(shift(d, g.pick([1, 2, 3, -1, -2, -3])), g, c), c }
  })
  guard('sign, in any form', 32, g => {
    const d = someAmount(g), c = amountType(g)
    return { approved: write(d, g, c), changed: write({ units: -d.units, scale: d.scale }, g, c), c }
  })
  guard('another record\'s value, in any form its type admits', 33, g => {
    if (g.bool()) {
      const a = someAmount(g), b = someAmount(g), c = amountType(g)
      if (canonical(a) === canonical(b)) return undefined
      return { approved: write(a, g, c), changed: write(b, g, c), c }
    }
    const flags = { case_insensitive: g.bool(), whitespace_insensitive: g.bool() }
    const a = `INV-${g.digits(4)}-${g.pick(['A', 'B'])}`, b = `INV-${g.digits(4)}-${g.pick(['A', 'B'])}`
    if (a === b) return undefined
    return { approved: idForm(a, g, flags), changed: idForm(b, g, flags), c: { type: 'identifier', ...flags } }
  })
  guard('a leading zero added or removed, in any form', 34, g => {
    const base = g.pick(['digits', 'account', 'numeric'])
    const flags = { case_insensitive: g.bool(), whitespace_insensitive: g.bool() }
    if (base === 'numeric') {
      const d: D = { units: g.int(1, 99_999_999), scale: g.pick([0, 2]) }, c = amountType(g)
      return { approved: write(d, g, c), changed: `0${numeralOf(d, g)}`, c }
    }
    const id = base === 'digits' ? `${g.int(1, 9)}${g.digits(g.int(3, 9))}` : `${g.int(1, 9)}${g.digits(2)}-${g.digits(3)}-${g.digits(4)}`
    const padded = `${'0'.repeat(g.int(1, 3))}${id}`
    const c: Comparison = g.pick<Comparison>([{ type: 'identifier', ...flags }, { type: 'undeclared' }, { type: 'text' }])
    const as = (s: string): Scalar => (c.type === 'identifier' ? idForm(s, g, flags) : base === 'digits' && g.bool(0.3) && !/^0/.test(s) ? Number(s) : s)
    return g.bool() ? { approved: as(padded), changed: as(id), c } : { approved: as(id), changed: as(padded), c }
  })
  guard('an ambiguous numeric date, or one written in the other order', 35, g => {
    const y = g.int(2000, 2040), m = g.int(1, 12), d = g.int(1, 28)
    const order = g.pick([undefined, 'DMY', 'MDY'] as const)
    const c: Comparison = { type: 'date', ...(order ? { order } : {}) }
    const sep = g.pick(['/', '-', '.'])
    const dmy = `${pad2(d)}${sep}${pad2(m)}${sep}${y}`, mdy = `${pad2(m)}${sep}${pad2(d)}${sep}${y}`
    if (order === undefined) return { approved: dateForm(y, m, d, g), changed: g.pick([dmy, mdy]), c }
    if (m === d) return undefined // both orders read the same date: not a wrong order
    return { approved: dateForm(y, m, d, g, order), changed: order === 'DMY' ? mdy : dmy, c }
  })
  guard('a wrong or undeclared currency marker', 36, g => {
    const d = someAmount(g)
    const declared = g.pick([undefined, ...CURRENCIES])
    const others = CURRENCIES.filter(x => x !== declared)
    const wrong = g.pick(others)
    const foreignSymbols = Object.keys(CURRENCY_SYMBOLS).filter(s => !declared || !CURRENCY_SYMBOLS[s]!.includes(declared))
    const p = parts(d), body = `${p.int}${p.frac ? `.${p.frac}` : ''}`, sign = p.neg ? '-' : ''
    const changed = g.pick([`${sign}${wrong} ${body}`, `${sign}${body} ${wrong}`, `${sign}${g.pick(foreignSymbols)}${body}`, `${sign}${body}${g.pick(foreignSymbols)}`])
    const c: Comparison = declared ? { type: 'amount', currency: declared } : g.pick<Comparison>([{ type: 'amount' }, { type: 'undeclared' }])
    return { approved: asNumber(d) ?? canonical(d), changed, c }
  })
  guard('percent against fraction without a declared unit, or in the wrong unit', 37, g => {
    const k = g.int(1, 999)
    const f: D = { units: k, scale: 3 }, p: D = { units: k, scale: 1 }
    switch (g.int(0, 2)) {
      case 0: return { approved: undeclaredForm(f, g), changed: `${numeralOf(p, g)}%`, c: { type: 'undeclared' } }
      case 1: return { approved: rateForm(k, 'fraction', g), changed: undeclaredForm(p, g), c: { type: 'rate', unit: 'fraction' } }
      default: return { approved: rateForm(k, 'percent', g), changed: g.pick([undeclaredForm(f, g), `${numeralOf({ units: k, scale: 5 }, g)}%`]), c: { type: 'rate', unit: 'percent' } }
    }
  })
  guard('a comma as a decimal mark (the value written the European way)', 38, g => {
    const d: D = { units: g.int(1, 99_999_999), scale: g.pick([1, 2, 3]) }
    const p = parts(d)
    if (!p.frac) return undefined
    const int = p.int.length > 3 && g.bool() ? p.int.replace(/\B(?=(\d{3})+(?!\d))/g, '.') : p.int
    const c = amountType(g)
    const marker = c.type === 'amount' && c.currency ? g.pick(['', `${c.currency} `]) : ''
    return { approved: write(d, g, c), changed: `${marker}${int},${p.frac}${g.pick(['', '0'])}`, c }
  })
})

describe('B4 in the suite: the default moves a verdict only where it names 0.2.0, and only toward PASS', () => {
  it('2,000 mixed calls: byte-identical to 0.1.0 unless relabelled; never away from PASS; never to FAIL', LONG, () => {
    const g = new G(4)
    let relabelled = 0
    for (let i = 0; i < 2_000; i++) {
      const numbers = g.bool()
      const grp = group2to7(g, numbers)
      const k = g.int(0, grp.records.length - 1)
      const args: Record<string, unknown> = { ...grp.records[k] }
      const d = grp.amounts[k]!
      switch (g.int(0, 6)) {
        case 0: args.amount = undeclaredForm(d, g); break
        case 1: args.amount = undeclaredForm(shift(d, g.pick([1, -1, 2])), g); break
        case 2: args.amount = undeclaredForm({ units: -d.units, scale: d.scale }, g); break
        case 3: args.to_account = grp.records[(k + 1) % grp.records.length]!.to_account; break
        case 4: delete args.reference; args.amount = undeclaredForm(d, g); break
        case 5: args.amount = amountForm(d, g, 'USD'); break
        default: break
      }
      const sources = sourcesFor(grp, g)
      if (g.bool(0.2)) sources.fields = { amount: { type: 'amount', currency: 'USD' } }
      const action: ProposedAction = { tool: 'pay_invoice', arguments: args }
      const now = verifyAction(action, sources, NOW), old = verifyAction(action, sources, { ...NOW, ruleset: 'action@0.1.0' })
      if (now.ruleset.version === '0.2.0') relabelled++
      else expect(JSON.stringify(now)).toBe(JSON.stringify(old))
      if (old.outcome === 'PASS') expect(now.outcome).toBe('PASS')
      if (old.outcome !== 'FAIL') expect(now.outcome).not.toBe('FAIL')
    }
    expect(relabelled).toBe(229) // determinism pin, set after the first run
  })
})
