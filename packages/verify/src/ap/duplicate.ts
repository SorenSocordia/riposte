/**
 * The duplicate check under engine 0.6.0 (2026-10-05), shared by the text path (./index.ts) and the
 * structured path (./structured.ts). Engines 0.0.1 to 0.5.0 keep the check written inline in those files, byte for byte.
 *
 * What changed, and why. Before 0.6.0 two vendors were the same only when their trimmed, lower-cased names were identical, so
 * a bill numbered NM-84665 from "Northfield Material Handling, Inc." passed against NM-84665 already booked under "Northfield
 * Material Handling", and its explanation said the number "does not appear" in the books. Two vendor-master records for one
 * supplier is the classic way a duplicate gets paid. Under 0.6.0:
 *
 *   vendor identity, per booked row, strongest evidence first:
 *     tax id     both sides carry one: equal is the same supplier; different, with names that match or look alike, is a
 *                conflict a person resolves; different, with names that do not, is another supplier
 *     vendor id  both sides carry one: equal is the same supplier; different, with names that match, is a VARIANT (two vendor
 *                records, one name); different, with names that look alike, is a NEAR match; different, with names that do
 *                not, is another supplier
 *     name       either side has none: unknown, read as the same supplier (as before); identical after trimming and case: same;
 *                identical after normalizeVendorName (case, spacing, punctuation, a trailing company suffix): VARIANT;
 *                alike by nearVendorBasis (2026-10-05: a typo, an abbreviation, initials, a "d/b/a" name, a word left
 *                off): NEAR; otherwise another supplier
 *
 *   the claim, in this order (the first that applies decides):
 *     1. the same invoice number booked under the same or an unknown vendor          FAIL  (hold_duplicate)
 *     2. the same invoice number booked under a vendor VARIANT                        FAIL  (hold_duplicate), naming both vendors
 *     2b. the same invoice number booked under a NEAR-MATCH vendor (2026-10-05:
 *        a typo, an abbreviation, initials, a "d/b/a" name, a word left off;
 *        nearVendorBasis), whatever the PO and total                                  FAIL  (hold_duplicate), naming both vendor
 *                                                                                      strings and why they look alike
 *     3. the same invoice number under a tax-id conflict, or under another vendor
 *        with the same PO or the same total                                            can't-tell (a person confirms)
 *     4. the invoice number equal to a booked one apart from punctuation, spacing or
 *        leading zeros (NM84665 against NM-84665; 2026-10-06: SES-020417 against
 *        SES-20417), same, unknown, variant or near-match vendor                      can't-tell (a person confirms)
 *     5. a new number, same (variant, near-match) vendor, same PO and same total      can't-tell (possible resubmission), as before;
 *        2026-10-06 (structured input): PASS, naming the quantities, when every bill line's PO line carries
 *        invoiced_quantity_to_date and this bill stays within what was received net of earlier bills (DuplicateContext.netted)
 *     6. otherwise                                                                     PASS, and the explanation says when the
 *                                                                                      number IS booked, under another vendor,
 *                                                                                      with what that booked row carries
 * A FAIL is answered by the controller (the AP_DUPLICATE fail remedy, authority ap-controller); a can't-tell by a clerk
 * (authority ap-clerk). The near-match tier (2b) only ever moves a booked row to a stricter rule: a row it catches was
 * read as another supplier before, so it passed (6) or was a can't-tell (3); now it holds. Nothing that held passes.
 * Deterministic; no I/O.
 */
import type { ClaimVerdict, Evidence } from '../verdict/schema.js'
import type { RemedyTable } from '../verdict/remedy.js'
import { close, round2 } from './parse.js'

/** A booked invoice as the duplicate check reads it (both paths map their history rows to this). */
export interface BookedInvoice {
  invoice_number: string
  po_number?: string
  total?: number
  vendor?: string
  /** the payer's vendor-master id for the vendor it was booked under (structured input: payment_history[].vendor_id) */
  vendor_id?: string
  /** the vendor's tax id (EIN, VAT number) as booked (structured input: payment_history[].vendor_tax_id) */
  vendor_tax_id?: string
  paid_on?: string
  /** booked without a purchase order (2026-10-05; read by ./po-balance.ts only, never by the duplicate check) */
  no_purchase_order?: boolean
}

/** The bill's vendor as the duplicate check reads it. */
export interface BillVendor {
  name: string | null
  /** vendor-master ids the bill or its PO carries (bill.vendor.id, purchase_order.vendor.id) */
  ids: readonly string[]
  /** tax ids the bill or its PO carries (bill.vendor.tax_id, purchase_order.vendor.tax_id) */
  tax_ids: readonly string[]
  /**
   * 2026-10-06: the bill's own vendor name, when it is not `name` (structured input compares the purchase
   * order's vendor, else the bill's). Read only for the words: a bill whose own name only looks like the booked vendor's is
   * said to be from "a look-alike vendor", as the vendor check says it, never "same vendor".
   */
  bill_name?: string | null
}

/** Company-form words dropped from the END of a vendor name before comparing (repeatedly: "Co., Ltd." drops both). */
const SUFFIXES = new Set(['inc', 'incorporated', 'llc', 'ltd', 'limited', 'co', 'company', 'corp', 'corporation', 'gmbh', 'sa', 'plc', 'llp', 'lp'])

/** A vendor name's words: NFKC, lower case, "&" read as "and", periods, commas and apostrophes dropped, split on the rest. */
function vendorWords(name: string): string[] {
  return name.normalize('NFKC').toLowerCase().replace(/&/g, ' and ').replace(/[.,'’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean)
}

/** The words with trailing company-form words (SUFFIXES) dropped while a word remains. */
function withoutSuffixes(words: readonly string[]): string[] {
  const w = [...words]
  while (w.length > 1 && SUFFIXES.has(w[w.length - 1]!)) w.pop()
  return w
}

/**
 * A vendor name for comparison: NFKC, lower case, "&" read as "and", periods, commas and apostrophes dropped, every other
 * non-letter-or-digit a space, spaces collapsed, then trailing company-form words (SUFFIXES) dropped while a word remains.
 * "Northfield Material Handling, Inc." and "NORTHFIELD MATERIAL HANDLING" both read "northfield material handling".
 */
export function normalizeVendorName(name: string): string {
  return withoutSuffixes(vendorWords(name)).join(' ')
}

// ── near-match vendor names (engine 0.6.0) ─────────────────────────────────────────────────────────────
//
// Two names that are neither the same nor a variant can still name one supplier: a typo in one vendor record ("Sumit"), an
// abbreviation ("Summit Elec. Supply"), the initials as a trading name ("SES Electrical"), a "d/b/a" name, or one name with a
// word left off. Two vendor records for one supplier is how a duplicate gets paid, so the same invoice number under such a
// name holds for the controller. The tests are deterministic and run only on names already found not to be the same.

/** Trading-name markers as vendorWords leaves them ("d/b/a" reads d b a; "d.b.a." reads dba). */
const TRADE_MARKERS: readonly (readonly string[])[] = [['d', 'b', 'a'], ['dba'], ['doing', 'business', 'as'], ['t', 'a'], ['trading', 'as'], ['aka'], ['a', 'k', 'a'], ['also', 'known', 'as']]

/** Contractions a prefix test misses ("intl" is not a prefix of "international"); a word that is a prefix of 3+ letters counts too. */
const ABBREVIATIONS: Readonly<Record<string, readonly string[]>> = {
  mfg: ['manufacturing'], mfr: ['manufacturer', 'manufacturing'], mfrs: ['manufacturers'], svc: ['service', 'services'], svcs: ['services'],
  intl: ['international'], natl: ['national'], bros: ['brothers'], assn: ['association'], ctr: ['center', 'centre'], mgmt: ['management'],
  mgt: ['management'], plbg: ['plumbing'], whse: ['warehouse'], whsl: ['wholesale'], whsle: ['wholesale'], eqpt: ['equipment'],
  sply: ['supply'], hldgs: ['holdings'], matl: ['material', 'materials'], matls: ['materials'], engr: ['engineering', 'engineers'],
  envtl: ['environmental'], inds: ['industries'], solns: ['solutions'], grp: ['group'], prods: ['products'], dept: ['department'],
  n: ['north'], s: ['south'], e: ['east'], w: ['west'], st: ['saint', 'street'], mt: ['mount'], ft: ['fort'],
}
const STOPWORDS = new Set(['and', 'of', 'the'])

/** True when word `a` abbreviates word `b`: a listed contraction, or a prefix of at least `min` letters (3 unless said). */
const abbreviates = (a: string, b: string, min = 3): boolean => (ABBREVIATIONS[a]?.includes(b) ?? false) || (a.length >= min && a.length < b.length && b.startsWith(a))

/** The initials of a run of words, with and without the stopwords ("bank of america": boa, ba). */
const initialsOf = (words: readonly string[]): string[] => {
  const all = words.map((w) => w[0]).join('')
  const bare = words.filter((w) => !STOPWORDS.has(w)).map((w) => w[0]).join('')
  return all === bare ? [all] : [all, bare]
}

/** Optimal string alignment distance (insert, delete, substitute, swap two neighbours), over code points. */
export function editDistance(a: string, b: string): number {
  const x = Array.from(a), y = Array.from(b)
  const d: number[][] = Array.from({ length: x.length + 1 }, (_, i) => Array.from({ length: y.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)))
  for (let i = 1; i <= x.length; i++) {
    for (let j = 1; j <= y.length; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost)
      if (i > 1 && j > 1 && x[i - 1] === y[j - 2] && x[i - 2] === y[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1)
      d[i]![j] = v
    }
  }
  return d[x.length]![y.length]!
}

/** The most characters two names of this length may differ by and still look alike: 0 under 6, 1 under 16, 2 under 32, else 3. */
export const allowedEdits = (n: number): number => (n < 6 ? 0 : n < 16 ? 1 : n < 32 ? 2 : 3)
const COUNT = ['no', 'one', 'two', 'three']
const q = (words: readonly string[]): string => `'${words.join(' ')}'`

/** Why two word lists (suffixes dropped, not equal) look alike, or null. */
function nearWords(a: readonly string[], b: readonly string[]): string | null {
  const sa = a.join(' '), sb = b.join(' ')
  // a typo: a small edit distance relative to length
  const n = Math.max(Array.from(sa).length, Array.from(sb).length)
  const d = editDistance(sa, sb)
  if (d >= 1 && d <= allowedEdits(n)) {
    const pairs = a.length === b.length ? a.map((w, i) => [w, b[i]!] as const).filter(([u, v]) => u !== v) : []
    const where = pairs.length ? pairs.map(([u, v]) => `'${u}' against '${v}'`).join(', ') : `${q(a)} against ${q(b)}`
    return `they differ by ${COUNT[d]} character${d === 1 ? '' : 's'} (${where})`
  }
  // an abbreviation: the same words, each equal or one abbreviating the other, at least one equal. A word is cut to 3 letters or
  // more; to 1 letter or more when at least two other words are equal ("pemberton lab gl" for "pemberton lab glass": the two
  // equal words carry the identity, and a cut word never differs from its whole except by what was cut)
  if (a.length === b.length && a.length >= 2 && a.some((w, i) => w === b[i])) {
    const pairs = a.map((w, i) => [w, b[i]!] as const).filter(([u, v]) => u !== v)
    const min = a.length - pairs.length >= 2 ? 1 : 3
    if (pairs.length && pairs.every(([u, v]) => abbreviates(u, v, min) || abbreviates(v, u, min))) {
      return pairs.map(([u, v]) => (abbreviates(u, v, min) ? `'${u}' abbreviates '${v}'` : `'${v}' abbreviates '${u}'`)).join(', ')
    }
  }
  // initials: a word of one name is the initials of the whole other name ("ses electrical", "summit electrical supply") ...
  for (const [x, y] of [[a, b], [b, a]] as const) {
    if (y.length < 2) continue
    const ini = initialsOf(y).filter((s) => s.length >= 2)
    const w = x.find((t) => ini.includes(t))
    if (w) return `'${w}' is the initials of ${q(y)}`
  }
  // ... or of the run of words it stands in for, the rest equal ("se supply", "summit electrical supply")
  for (const [x, y] of [[a, b], [b, a]] as const) {
    if (y.length < x.length + 1) continue
    let p = 0
    while (p < x.length && x[p] === y[p]) p++
    let s = 0
    while (s < x.length - p && x[x.length - 1 - s] === y[y.length - 1 - s]) s++
    const mid = x.slice(p, x.length - s), run = y.slice(p, y.length - s)
    if (mid.length === 1 && run.length >= 2 && initialsOf(run).includes(mid[0]!)) return `'${mid[0]}' is the initials of ${q(run)}`
  }
  // one name is the other with up to two words left off (in order), keeping two words or a leading word of 4+ letters
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  if (long.length > short.length && long.length - short.length <= 2 && (short.length >= 2 || (short[0] === long[0] && short[0]!.length >= 4))) {
    let k = 0
    for (const w of long) if (k < short.length && w === short[k]) k++
    if (k === short.length) return `${q(short)} is ${q(long)} without ${q(long.filter((w) => !short.includes(w)))}`
  }
  return null
}

/** The names a vendor string carries: itself, and each side of a trading-name marker ("Acme Holdings dba Summit Supply"). */
function tradeNames(name: string): { parts: string[][]; marker: boolean } {
  const w = vendorWords(name)
  for (let i = 1; i < w.length; i++) {
    for (const m of TRADE_MARKERS) {
      if (i + m.length < w.length && m.every((t, k) => w[i + k] === t)) {
        return { parts: [withoutSuffixes(w.slice(0, i)), withoutSuffixes(w.slice(i + m.length))].filter((p) => p.length), marker: true }
      }
    }
  }
  return { parts: [withoutSuffixes(w)], marker: false }
}

/**
 * Why two vendor names look alike (engine 0.6.0): a typo, an abbreviation, initials, a trading name, or a word left off. Null
 * when they do not, and for names that are already the same after normalizeVendorName (that is a variant, not a near match).
 */
export function nearVendorBasis(a: string, b: string): string | null {
  const wa = withoutSuffixes(vendorWords(a)), wb = withoutSuffixes(vendorWords(b))
  if (!wa.length || !wb.length || wa.join(' ') === wb.join(' ')) return null
  const ta = tradeNames(a), tb = tradeNames(b)
  if (ta.marker || tb.marker) {
    for (const x of ta.parts) {
      for (const y of tb.parts) {
        if (x.join(' ') === y.join(' ')) return `a trading name ("d/b/a") on one side is the other name: ${q(x)}`
        const why = nearWords(x, y)
        if (why) return `a trading name ("d/b/a") on one side looks like the other name: ${why}`
      }
    }
  }
  return nearWords(wa, wb)
}

/** A tax id for comparison: upper case, spaces, hyphens, periods and slashes dropped. */
export const normalizeTaxId = (s: string): string => s.normalize('NFKC').toUpperCase().replace(/[\s\-./]/g, '')

/**
 * An invoice number with every character that is not a letter or digit dropped, upper-cased: NM-84665 and nm 84665 agree.
 * 2026-10-06: leading zeros of each run of digits are dropped too, as punctuation is, so SES-020417 and
 * SES-20417 agree (a run of zeros alone keeps one). A number read this way is a person's decision, never a hold.
 */
export const looseNumber = (s: string): string => s.normalize('NFKC').toUpperCase().replace(/(^|[^\p{N}])0+(?=\p{N})/gu, '$1').replace(/[^\p{L}\p{N}]/gu, '')

/**
 * 'near' (engine 0.6.0): names that are neither the same nor a variant but look alike (nearVendorBasis). It is
 * read as at least as suspicious as a variant: the same invoice number under it holds, for the controller.
 */
export type VendorMatch = 'same' | 'unknown' | 'variant' | 'near' | 'conflict' | 'different'

/** How a booked row's vendor relates to the bill's, and the words that say why. */
export function matchVendor(bill: BillVendor, h: BookedInvoice): { match: VendorMatch; basis: string } {
  const nameOf = (): { n: 'same' | 'variant' | 'near' | 'different' | 'unknown'; nearBasis: string | null } => {
    if (!h.vendor || !bill.name) return { n: 'unknown', nearBasis: null }
    if (h.vendor.trim().toLowerCase() === bill.name.trim().toLowerCase()) return { n: 'same', nearBasis: null }
    if (normalizeVendorName(h.vendor) === normalizeVendorName(bill.name)) return { n: 'variant', nearBasis: null }
    const nearBasis = nearVendorBasis(h.vendor, bill.name)
    return { n: nearBasis ? 'near' : 'different', nearBasis }
  }
  const { n, nearBasis } = nameOf()
  const nameMatches = n === 'same' || n === 'variant'
  const looksAlike = `the vendor names look alike (${nearBasis})`
  if (h.vendor_tax_id && bill.tax_ids.length) {
    if (bill.tax_ids.map(normalizeTaxId).includes(normalizeTaxId(h.vendor_tax_id))) return { match: 'same', basis: `the same tax id (${h.vendor_tax_id})` }
    const ids = `(booked ${h.vendor_tax_id}; this bill ${bill.tax_ids.join(', ')})`
    if (nameMatches) return { match: 'conflict', basis: `the vendor names match but the tax ids differ ${ids}` }
    // tax ids are the strongest evidence of two legal entities: names that only look alike under two tax ids are a conflict
    // for a person, exactly as matching names are
    if (n === 'near') return { match: 'conflict', basis: `${looksAlike} but the tax ids differ ${ids}` }
    return { match: 'different', basis: `another tax id (${h.vendor_tax_id})` }
  }
  if (h.vendor_id && bill.ids.length) {
    if (bill.ids.includes(h.vendor_id.trim())) return { match: 'same', basis: `the same vendor id (${h.vendor_id})` }
    if (nameMatches) return { match: 'variant', basis: `another vendor id (booked ${h.vendor_id}; this bill ${bill.ids.join(', ')}) but a matching name: two vendor records for one supplier is how duplicates get paid` }
    if (n === 'near') return { match: 'near', basis: `another vendor id (booked ${h.vendor_id}; this bill ${bill.ids.join(', ')}) under names that look alike: ${nearBasis}` }
    return { match: 'different', basis: `another vendor id (${h.vendor_id})` }
  }
  if (n === 'unknown') return { match: 'unknown', basis: 'a vendor name is missing on one side' }
  if (n === 'same') return { match: 'same', basis: 'the same vendor name' }
  if (n === 'variant') return { match: 'variant', basis: 'vendor names that differ only in case, spacing, punctuation or a company suffix' }
  if (n === 'near') return { match: 'near', basis: `the names look alike: ${nearBasis}` }
  return { match: 'different', basis: 'another vendor name' }
}

/** Where the claim's operands live: the invoice number's evidence, and one booked row's. */
export interface DuplicateContext {
  invoice_number: string
  /** evidence for the bill's invoice number (a span or a JSON Pointer, as the path reads it) */
  invoiceEvidence: Evidence
  /** evidence for booked row i */
  historyEvidence: (i: number) => Evidence
  /** evidence for the whole history (the PASS claim's CONTEXT) */
  historyContext: Evidence
  history: readonly BookedInvoice[]
  vendor: BillVendor
  po_number: string | null
  total: number | null
  total_tolerance: number
  /**
   * 2026-10-06, structured input only: the bill's lines netted against the quantity earlier bills invoiced on each PO line
   * (invoiced_quantity_to_date), given when every bill line matches a PO line that carries it, has a quantity and a goods
   * receipt, bills no more than was received net of earlier bills, and at least one line records an earlier bill. It settles a
   * possible resubmission (rule 5): the receipts hold units no earlier bill invoiced, and this bill bills them.
   */
  netted?: { lines: readonly { name: string; L: number; earlier: number; this_bill: number; received: number }[]; evidence: readonly Evidence[] } | null
  /**
   * Engine 0.7.0 (2026-10-13): a possible resubmission (rule 5) whose booked number is similar to this bill's (similarNumber:
   * one is the other with a suffix, or they differ by one character) says "a bill with a similar number is booked", naming
   * both numbers, never that this invoice is booked.
   */
  similarNumbers?: boolean
}

/**
 * Engine 0.7.0: two invoice numbers that are not the same as looseNumber reads them, but one is the other with a suffix of up to
 * three letters or digits ("GCS-20417A", "AJ-97466-1"), or they differ by one character (six characters or more).
 */
export function similarNumber(a: string, b: string): boolean {
  const x = looseNumber(a), y = looseNumber(b)
  if (!x || !y || x === y) return false
  const [s, l] = x.length <= y.length ? [x, y] : [y, x]
  if (s.length >= 4 && l.startsWith(s) && l.length - s.length <= 3) return true
  return l.length >= 6 && editDistance(x, y) === 1
}

const quoted = (s: string | undefined | null): string => (s ? `'${s}'` : 'no vendor name')
const base = { claim_id: 'ap.duplicate', kind: 'CROSS_REFERENCE' as const, tier: 'DETERMINISTIC' as const, field: 'invoice_number', rule_id: 'AP_DUPLICATE', rule_name: 'Invoice not already booked' }
const FORMULA = 'invoice_number not in history (same vendor; vendors compared by tax id, vendor id, then normalized name)'

/** The duplicate claim under engine 0.6.0. */
export function duplicateClaimV060(x: DuplicateContext): ClaimVerdict {
  const num = x.invoice_number.trim().toUpperCase()
  const rows = x.history.map((h, i) => ({ h, i, v: matchVendor(x.vendor, h), exact: h.invoice_number.trim().toUpperCase() === num }))
  const abstain = (detail: string, i: number, operands: Record<string, string | number | boolean | null>): ClaimVerdict => ({
    ...base, outcome: 'INSUFFICIENT_DATA', asserted: null, evidence: [x.historyEvidence(i)], insufficiency: { reason: 'AMBIGUOUS_REFERENCE', detail },
    computation: { formula: FORMULA, operands: { invoice_number: x.invoice_number, ...operands }, result: null }, locked: false, explanation: detail,
  })
  const fail = (r: (typeof rows)[number], explanation: string): ClaimVerdict => ({
    ...base, outcome: 'FAIL', asserted: x.invoice_number,
    computation: { formula: FORMULA, operands: { invoice_number: x.invoice_number, booked_as: r.h.invoice_number, booked_vendor: r.h.vendor ?? null, bill_vendor: x.vendor.name, vendor_match: r.v.match }, result: r.h.invoice_number },
    evidence: [x.invoiceEvidence, x.historyEvidence(r.i)], locked: true, explanation,
  })
  const paid = (h: BookedInvoice): string => (h.paid_on ? ` (paid ${h.paid_on})` : '')

  // 1. the same number, the same or an unknown vendor
  const same = rows.find((r) => r.exact && (r.v.match === 'same' || r.v.match === 'unknown'))
  if (same) {
    const why = same.v.match === 'same' && same.v.basis !== 'the same vendor name' ? `, under ${same.v.basis}` : ''
    return fail(same, `Invoice ${x.invoice_number} is already in the books${paid(same.h)}${why}. Paying it again would be a duplicate payment.`)
  }
  // 2. the same number, a vendor variant: hold, naming both vendors
  const variant = rows.find((r) => r.exact && r.v.match === 'variant')
  if (variant) {
    return fail(variant, `same invoice number ${x.invoice_number} already booked under ${quoted(variant.h.vendor)}${paid(variant.h)}; this bill says ${quoted(x.vendor.name)} (${variant.v.basis}); a person confirms this is not the same bill before it is paid`)
  }
  const samePo = (h: BookedInvoice): boolean => x.po_number !== null && h.po_number !== undefined && h.po_number.trim() === x.po_number.trim()
  const sameTotal = (h: BookedInvoice): boolean => x.total !== null && h.total !== undefined && close(round2(h.total), round2(x.total), x.total_tolerance)
  /** What a booked row carries to compare with this bill, said only as far as the row carries it. */
  const compared = (h: BookedInvoice): string => {
    const po = h.po_number === undefined ? null : x.po_number === null ? `PO ${h.po_number}, where this bill states no single PO` : samePo(h) ? `the same PO, ${h.po_number}` : `another PO, ${h.po_number}`
    const total = h.total === undefined ? null : x.total === null ? `total ${h.total}, where this bill states no single total` : sameTotal(h) ? `the same total, ${h.total}` : `another total, ${h.total}`
    if (po === null && total === null) return 'the booked row carries no PO or amount to compare'
    if (po === null) return `the booked row has ${total}, and carries no PO to compare`
    if (total === null) return `the booked row has ${po}, and carries no amount to compare`
    return `the booked row has ${po}, and ${total}`
  }
  // 2b. the same number, a near-match vendor (2026-10-05): hold for the controller, whatever the PO and total say
  const look = rows.find((r) => r.exact && r.v.match === 'near')
  if (look) {
    return fail(look, `same invoice number ${x.invoice_number} already booked under ${quoted(look.h.vendor)}${paid(look.h)}; this bill says ${quoted(x.vendor.name)}: ${look.v.basis}; ${compared(look.h)}. A look-alike vendor record is how one supplier's bill gets paid twice: the controller confirms this is not the same bill before it is paid`)
  }
  // 3. the same number under a tax-id conflict, or another vendor with the same PO or total
  const conflict = rows.find((r) => r.exact && (r.v.match === 'conflict' || (r.v.match === 'different' && (samePo(r.h) || sameTotal(r.h)))))
  if (conflict) {
    const h = conflict.h
    const also = [samePo(h) ? `the same PO (${h.po_number})` : '', sameTotal(h) ? `the same total (${h.total})` : ''].filter(Boolean).join(' and ')
    return abstain(`invoice number ${x.invoice_number} is already booked under ${quoted(h.vendor)}${paid(h)}; this bill says ${quoted(x.vendor.name)}: ${conflict.v.basis}${also ? `, with ${also}` : ''}; a person confirms these are different suppliers before it is paid`, conflict.i,
      { booked_as: h.invoice_number, booked_vendor: h.vendor ?? null, bill_vendor: x.vendor.name, vendor_match: conflict.v.match })
  }
  /**
   * The vendor a can't-tell names, in one phrase (2026-10-06): a booked row whose vendor only looks like this bill's, or a
   * bill whose own vendor name only looks like the booked one's (structured input compares the purchase order's vendor), is
   * "a look-alike vendor", the words the vendor check uses; otherwise null, and the comparison's own words are used.
   */
  const lookAlike = (r: (typeof rows)[number]): string | null => {
    const billName = x.vendor.bill_name ?? x.vendor.name
    if (r.v.match === 'near') return `a look-alike vendor (booked as ${quoted(r.h.vendor)}; this bill says ${quoted(billName)}: ${r.v.basis.replace(/^the names look alike: /, '')})`
    const booked = r.h.vendor ?? x.vendor.name
    const why = x.vendor.bill_name && booked ? nearVendorBasis(x.vendor.bill_name, booked) : null
    return why ? `a look-alike vendor (booked as ${quoted(booked)}; this bill says ${quoted(x.vendor.bill_name)}: ${why})` : null
  }
  // 4. the number equal apart from punctuation, spacing or leading zeros, the same (or an unknown or variant) vendor
  const loose = looseNumber(x.invoice_number)
  const near = loose !== '' ? rows.find((r) => !r.exact && looseNumber(r.h.invoice_number) === loose && r.v.match !== 'different' && r.v.match !== 'conflict') : undefined
  if (near) {
    return abstain(`invoice number ${x.invoice_number} matches booked invoice ${near.h.invoice_number}${paid(near.h)} apart from punctuation, spacing or leading zeros, under ${lookAlike(near) ?? near.v.basis}; a person confirms this is a new bill and not a resubmission`, near.i,
      { booked_as: near.h.invoice_number, booked_vendor: near.h.vendor ?? null, bill_vendor: x.vendor.name, vendor_match: near.v.match })
  }
  // 5. a new number: same (or variant) vendor, same PO, same total
  const resub = rows.find((r) => r.v.match !== 'different' && r.v.match !== 'conflict' && x.po_number !== null && r.h.po_number === x.po_number && sameTotal(r.h))
  if (resub) {
    const h = resub.h
    const who = lookAlike(resub) ?? 'same vendor'
    // 2026-10-06: the purchase order's lines record what earlier bills invoiced, and this bill bills units received and not
    // yet invoiced: a new delivery by the ERP's own figures, so the check passes, naming them (a look-alike vendor still asks)
    if (x.netted && x.netted.lines.length && !lookAlike(resub)) {
      const n6 = (v: number): number => Math.round(v * 1e6) / 1e6
      const said = x.netted.lines.map((l) => `${l.name}: ${l.earlier} invoiced earlier on PO line ${l.L} + ${l.this_bill} on this bill = ${n6(l.earlier + l.this_bill)} of ${l.received} received`).join('; ')
      return {
        ...base, outcome: 'PASS', asserted: x.invoice_number,
        computation: { formula: FORMULA, operands: { invoice_number: x.invoice_number, history_size: x.history.length, same_number_other_vendor: rows.filter((r) => r.exact).length, resubmission_settled_by: 'invoiced_quantity_to_date', booked_as: h.invoice_number }, result: null },
        evidence: [x.invoiceEvidence, x.historyEvidence(resub.i), ...x.netted.evidence], locked: true,
        explanation: `Same vendor, same PO (${h.po_number}) and same total (${h.total}) as booked invoice ${h.invoice_number}, under a different number, but not a resubmission by the purchase order's own figures: ${said} (invoiced_quantity_to_date). This bill bills units received and not yet invoiced.`,
      }
    }
    // engine 0.7.0: a booked number one suffix or one character away is said to be similar, never the same
    if (x.similarNumbers && similarNumber(x.invoice_number, h.invoice_number)) {
      return abstain(`possible resubmission: a bill with a similar number is booked: ${h.invoice_number}${paid(h)}, ${who}, same PO (${h.po_number}) and same total (${h.total}), under the number ${x.invoice_number} — a person should confirm this is a new delivery`, resub.i,
        { booked_as: h.invoice_number, booked_vendor: h.vendor ?? null, bill_vendor: x.vendor.name, vendor_match: resub.v.match, similar_number: true })
    }
    return abstain(`possible resubmission: ${who}, same PO (${h.po_number}) and same total (${h.total}) as booked invoice ${h.invoice_number}, under a different number — a person should confirm this is a new delivery`, resub.i,
      { booked_as: h.invoice_number, booked_vendor: h.vendor ?? null, bill_vendor: x.vendor.name, vendor_match: resub.v.match })
  }
  // 6. PASS, saying so when the number is booked under another vendor, and what each such booked row carries (never claiming
  //    "another PO and another total" for a row that carries neither)
  const elsewhere = rows.filter((r) => r.exact)
  const explanation = elsewhere.length
    ? `Invoice number ${x.invoice_number} is also booked under ${elsewhere.map((r) => `${quoted(r.h.vendor)} (${r.v.basis}; ${compared(r.h)})`).join(' and under ')}, so it reads as another supplier's invoice; it is not booked under this vendor (${quoted(x.vendor.name)}).`
    : `Invoice ${x.invoice_number} does not appear among ${x.history.length} booked invoice(s).`
  return {
    ...base, outcome: 'PASS', asserted: x.invoice_number,
    computation: { formula: FORMULA, operands: { invoice_number: x.invoice_number, history_size: x.history.length, same_number_other_vendor: elsewhere.length }, result: null },
    evidence: [x.invoiceEvidence, x.historyContext], locked: true, explanation,
  }
}

/** The claim when no payment history is supplied (engine 0.6.0): stated as a check that did not run, never omitted. */
export const NO_HISTORY_DETAIL = 'duplicate check not run: no payment history supplied, so this bill was not compared with what is already booked'

export function noHistoryClaim(detailTail: string): ClaimVerdict {
  const detail = `${NO_HISTORY_DETAIL} (${detailTail})`
  return { ...base, outcome: 'INSUFFICIENT_DATA', asserted: null, evidence: [], insufficiency: { reason: 'REFERENCE_NOT_PROVIDED', detail, missing: [] }, locked: false, explanation: detail }
}

/**
 * The AP_DUPLICATE remedies under engine 0.6.0: the earlier table's, with the can't-tell remedies told apart by what the
 * claim says (a new number, a vendor variant, a missing history). The other rules' remedies are unchanged. A table, not a
 * patch: the verdict_id binds the whole table (protocol/verdict-id.ts), and engines up to 0.5.0 keep the earlier one.
 */
export function duplicateRemediesV060(prior: RemedyTable): RemedyTable {
  return {
    ...prior,
    AP_DUPLICATE: {
      fail: [
        { kind: 'authority', authority: 'ap-controller',
          detail: 'Invoice {asserted} is already booked ({op:booked_as}, vendor {op:booked_vendor}). Paying it again is lawful only if that booking was voided or credited, or it belongs to another supplier: the controller rules, for this verdict only.' },
      ],
      abstain: [
        { kind: 'authority', authority: 'ap-clerk', when: ['AMBIGUOUS_REFERENCE'],
          detail: 'A person compares this bill with booked invoice {op:booked_as} (vendor {op:booked_vendor}) and confirms it is a new bill from this supplier, not one already paid, for this verdict only.' },
        { kind: 'missing-operand', operand: { source: 'history' }, when: ['AMBIGUOUS_REFERENCE'],
          detail: 'The vendor id or tax id on both this bill and the booked invoice settles whether they are one supplier: supply it, and the check runs again.' },
        { kind: 'missing-operand', operand: { source: 'history' }, when: ['REFERENCE_NOT_PROVIDED'],
          detail: 'The payment history (invoices already booked or paid for this vendor), so the duplicate check runs: until then this bill has not been checked for a duplicate.' },
        { kind: 'recompute-with', operand: { source: 'invoice', path: 'invoice_number' }, when: ['UNPARSEABLE'],
          detail: 'A legible invoice number, so the duplicate check can run.' },
      ],
    },
  }
}
