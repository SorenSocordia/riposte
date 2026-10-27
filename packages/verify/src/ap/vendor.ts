/**
 * The vendor check (engine 0.6.0, 2026-10-05), shared by the structured path (./structured.ts) and
 * the text path (./index.ts). Engines up to 0.5.0 have no such claim: their verdicts are unchanged.
 *
 * Why. A bill from "Apex Industrial Holdings" against a purchase order placed with "Summit Electrical Supply", with the right
 * lines, quantities and prices, was approved on both paths, and the vendor was never printed. Invoicing against a known PO
 * number is the oldest AP fraud there is, and here the two documents the check holds disagree with each other.
 *
 * Structured input. The bill's vendor (bill.vendor) is compared with the purchase order's (purchase_order.vendor) by the
 * duplicate check's own ladder (./duplicate.ts), strongest evidence first:
 *   tax id     both carry one: equal is one supplier; different is another supplier, or a conflict when the names match or look
 *              alike
 *   vendor id  both carry one: equal is one supplier; different under one name is two vendor records; under names that look
 *              alike, a near match; otherwise another supplier
 *   name       equal after trimming and case, or after normalizeVendorName (case, spacing, punctuation, a company suffix): one
 *              supplier; alike by nearVendorBasis (a typo, an abbreviation, initials, a "d/b/a" name, a word left off): a near
 *              match; otherwise another supplier
 *   The check PASSES only on one supplier. Everything else (another supplier, a near match, two vendor records, a tax-id
 *   conflict, or two vendors that cannot be compared) is a person's decision (INSUFFICIENT_DATA), never a FAIL, in words that
 *   name both vendors: "the bill is from Apex Industrial Holdings; the order was placed with Summit Electrical Supply".
 *   A purchase order that names no vendor: the check does not run, and not_checked says so. A bill that names none, against a
 *   purchase order that does: a person decides (FIELD_MISSING).
 *
 * Text input. The purchase order names its vendor on its first line ("PO-7740 | Vendor: Summit Electrical Supply | ..."); the
 * invoice is free text with no vendor field. The check reads whether the invoice carries the order's vendor:
 *   - a line of the invoice holds the vendor's name, its words in order (a trailing company suffix aside), each word as written
 *     or with two neighbouring letters swapped (a scanning or typing slip); or
 *   - a sender line's address (a line whose first word reads "From", colon or not) writes from a domain built from the name:
 *     its first word whole (or its first four letters or more), then each later word whole, cut short, or left out
 *     ("summitelec" for Summit Electrical Supply, "northfieldmh" for Northfield Material Handling). One swapped neighbouring
 *     pair is allowed in the word "From" and anywhere in the address, never two, never a dropped or changed letter.
 *   Either passes. Neither is a person's decision, naming the order's vendor and the sender's address. A name that only looks
 *   alike (a letter dropped or changed) does not count: on the text path a look-alike goes to a person as another name does.
 *   A purchase order with no "Vendor:" field: the check does not run, and not_checked says so.
 *
 * Text input (2026-10-06: a bill from ar@aldine-janitorial-payments.co, saying "our bank details have
 * changed", was approved for "Aldine Janitorial", its vendor evidence the subject line the sender wrote):
 *   - An email header line (Subject, To, Cc, Date, Re, Fwd) is never vendor evidence: the sender writes it.
 *   - Every sender's domain is compared with the vendor, by its registrable label (the one left of the public suffix, so the
 *     vendor's name as a subdomain of another domain does not count). A domain built from the name, with a company-form word
 *     beside it at most ("acmecorp", "acme-group"), is the vendor's. A LOOK-ALIKE domain is a near match for the controller and
 *     never evidence of identity: a name built from the vendor's with anything else added ("aldine-janitorial-payments"), one
 *     within a letter or two of such a name ("aidinejan"), or the vendor's name only in a subdomain ("aldinejan.com.evil.co").
 *   - When the purchase order names the vendor's domain or email ("Email: ar@aldinejan.com", "Domain:", "Website:"), the bill's
 *     sender (the first after a forward marker, else the first) must write from that domain; another domain is a person's
 *     decision, and a look-alike of it (or another domain built from the name) a near match for the controller.
 *   - Otherwise, as before: a sender writing from a domain built from the name passes (read first, the stronger evidence),
 *     else a line of the invoice that is not a header and carries the name.
 *   An approve says how the vendor was matched, and what that does not show, under "Not checked" (textVendorNotChecked).
 *
 * Text input (a cold reader's emailed bills from ar@aldine-jan.com, ar@aldinejan.co and a Gmail address were approved for
 * "Aldine Janitorial", whose own mail comes from aldinejan.com):
 *   - A domain on file is the purchase order's ("Email:", "Domain:", "Website:"), else the senders of this vendor's booked bills
 *     (a history row's `sender`, the address that bill came from). With one on file, the bill's sender writes from it or a
 *     person decides; the same name under another ending (aldinejan.co for aldinejan.com) or with a hyphen moved is a look-alike.
 *   - With none on file, the comparison works from the vendor's name: a sender passes only from the name run together (a
 *     company-form word aside), with a hyphen only where the vendor's own name has one, under an ending that is not one letter
 *     off .com. "aldine-jan.com" (a hyphen the name lacks) and "aldinejan.co" (.co, one letter off .com) are look-alikes for
 *     the controller, as "aidinejan.com" and "aldinejan-billing.com" already were.
 *   - A free-mail sender (gmail, outlook, hotmail, yahoo, icloud, proton, aol and the rest of FREE_MAIL) is a person's
 *     decision, unless that exact address is on file: anyone can open a free-mail address in any name.
 *
 * Text input, engine 0.7.0 (2026-10-13; ./v070.ts; a cold reader's bill `From: "billing@gulfcoastsupply.com"
 * <ar.dept@outlook-mailer.net>` was approved as "matched by the sender's address, billing@gulfcoastsupply.com"):
 *   - The sender is the address in angle brackets (or after "mailto:"); an address-shaped display name that is not the sender
 *     goes to a person, both named.
 *   - With no domain on file, a sender whose domain is not built from the vendor's name goes to a person; a line naming the
 *     vendor counts only when the bill names no sender, and never a header or signature line (signatureLines).
 *   - A hyphen is the vendor's own only where its name carries one: "gulfcoast-supply.com" for "Gulf Coast Supply" is a
 *     look-alike.
 *   - A sentence that matched only once two neighbouring letters were swapped back says so.
 *   - A domain on file passes only as written: the same domain with two neighbouring letters swapped is a look-alike, and the
 *     bill goes to the controller, both domains named (a swap is read back only in a domain built from the vendor's name).
 *
 * Text input, ruleset ap-threeway 0.4.0 (2026-10-19; `v040`; a cold reader's bill sent from ar@aldinejan.com with
 * "Reply-To: aldine.accounts@protonmail.com" was approved, the Reply-To not mentioned; test/fixtures/ap-r10/README.md):
 *   - A check that would pass goes to a person when a Reply-To line of the bill writes from another registrable domain than the
 *     From line of its own header block (the nearest From line above or below it with no blank line between; else the bill's
 *     sender). A reply to the bill goes to the Reply-To, so a Reply-To at another domain moves the payment conversation away
 *     from the vendor's mailbox. Both addresses are named (replyTosOf). A subdomain of the sender's domain is its own; a
 *     Reply-To in the forwarder's block is held to the forwarder's address.
 *   - With no domain on file, a sender whose domain is the vendor's name run together passes under .com only (2026-10-20; a
 *     cold reader's bill from ar@aldinejan.net, no domain on file, was approved; test/fixtures/ap-r10/README.md). Under another
 *     ending (.net, .org, a country ending) a person decides, the ending named: the vendor's name under another ending is the
 *     cheapest look-alike there is, and which ending is the vendor's own cannot be told until a domain is on file. A domain on
 *     file (the purchase order's, or a booked bill's sender) settles it whatever its ending.
 *   - An approve says whether the bill carried a Reply-To line, and that it wrote from the sender's domain, and, when a sender
 *     built from the vendor's name matched, that its ending is .com (textVendorNotChecked040). Both readings run only when the
 *     purchase order names its vendor, as the vendor check does.
 *
 * Deterministic; no I/O.
 */
import type { ClaimVerdict, Evidence, InsufficiencyReason } from '../verdict/schema.js'
import type { RuleRemedies } from '../verdict/remedy.js'
import { allowedEdits, editDistance, nearVendorBasis, normalizeTaxId, normalizeVendorName } from './duplicate.js'
import type { PriorInvoice } from './index.js'

export const AP_VENDOR_RULE = { id: 'AP_VENDOR_MATCH', name: "Bill is from the purchase order's vendor" } as const
const FORMULA_STRUCTURED = "bill.vendor = purchase_order.vendor (tax id, then vendor id, then normalized name)"
const FORMULA_TEXT = "the invoice names purchase_order.vendor (by name, or by a sender's address built from it)"

/** The not_checked line when the purchase order names no vendor. */
export const VENDOR_NOT_RUN = "vendor check: the purchase order names no vendor, so the bill's vendor was not compared with it"

/** A vendor as one side of the comparison carries it. */
export interface VendorSide { name: string | null; id: string | null; tax_id: string | null }

const given = (s: string | null | undefined): s is string => typeof s === 'string' && s.trim() !== ''
const sideOf = (v: { name?: string | null; id?: string | null; tax_id?: string | null } | null | undefined): VendorSide => ({
  name: given(v?.name) ? v!.name!.trim() : null, id: given(v?.id) ? v!.id!.trim() : null, tax_id: given(v?.tax_id) ? v!.tax_id!.trim() : null,
})
const empty = (s: VendorSide): boolean => s.name === null && s.id === null && s.tax_id === null

/** A vendor in words: its name, else its id, else its tax id. */
export function vendorLabel(s: VendorSide): string {
  return s.name ?? (s.id !== null ? `vendor id ${s.id}` : s.tax_id !== null ? `tax id ${s.tax_id}` : 'no vendor')
}

type Match = 'same' | 'variant' | 'records' | 'near' | 'conflict' | 'different' | 'unknown'

/** How the bill's vendor relates to the order's, and the words that say why (the duplicate check's ladder, in bill/order words). */
export function compareVendors(bill: VendorSide, po: VendorSide): { match: Match; basis: string } {
  const names = (): { n: 'same' | 'variant' | 'near' | 'different' | 'unknown'; near: string | null } => {
    if (bill.name === null || po.name === null) return { n: 'unknown', near: null }
    if (bill.name.toLowerCase() === po.name.toLowerCase()) return { n: 'same', near: null }
    if (normalizeVendorName(bill.name) === normalizeVendorName(po.name)) return { n: 'variant', near: null }
    const near = nearVendorBasis(bill.name, po.name)
    return { n: near ? 'near' : 'different', near }
  }
  const { n, near } = names()
  const nameMatches = n === 'same' || n === 'variant'
  if (bill.tax_id !== null && po.tax_id !== null) {
    if (normalizeTaxId(bill.tax_id) === normalizeTaxId(po.tax_id)) return { match: 'same', basis: `the same tax id, ${po.tax_id}` }
    const ids = `(the bill ${bill.tax_id}; the order ${po.tax_id})`
    if (nameMatches) return { match: 'conflict', basis: `the names match but the tax ids differ ${ids}` }
    if (n === 'near') return { match: 'conflict', basis: `the names look alike (${near}) but the tax ids differ ${ids}` }
    return { match: 'different', basis: `another tax id ${ids}` }
  }
  if (bill.id !== null && po.id !== null) {
    if (bill.id === po.id) return { match: 'same', basis: `the same vendor id, ${po.id}` }
    const ids = `(the bill ${bill.id}; the order ${po.id})`
    if (nameMatches) return { match: 'records', basis: `two vendor records under one name ${ids}: a bill entered under another vendor record than its order's is paid to that record` }
    // 2026-10-06: "a look-alike vendor", the phrase the duplicate check uses for the same finding
    if (n === 'near') return { match: 'near', basis: `a look-alike vendor, another vendor id ${ids}: ${near}` }
    return { match: 'different', basis: `another vendor id ${ids}` }
  }
  if (n === 'unknown') return { match: 'unknown', basis: 'they cannot be compared: one names its vendor only by a field the other does not carry' }
  if (n === 'same') return { match: 'same', basis: 'the same vendor name' }
  if (n === 'variant') return { match: 'variant', basis: 'names that differ only in case, spacing, punctuation or a company suffix' }
  if (n === 'near') return { match: 'near', basis: `a look-alike vendor: ${near}` }
  return { match: 'different', basis: 'another vendor name' }
}

const base = { claim_id: 'ap.vendor', kind: 'CROSS_REFERENCE' as const, tier: 'DETERMINISTIC' as const, field: 'vendor', rule_id: AP_VENDOR_RULE.id, rule_name: AP_VENDOR_RULE.name }
const open = (formula: string, operands: Record<string, string | number | boolean | null>, evidence: Evidence[], reason: InsufficiencyReason, detail: string, missing?: string[]): ClaimVerdict => ({
  ...base, outcome: 'INSUFFICIENT_DATA', asserted: null, computation: { formula, operands, result: null }, evidence,
  insufficiency: { reason, detail, ...(missing ? { missing } : {}) }, locked: false, explanation: detail,
})
const WHO = 'a person confirms who sent this bill, and that it is payable on this order, before it is paid'

/** Structured input: the claim, or why it did not run (the purchase order names no vendor). */
export function vendorClaimStructured(x: {
  bill: { name?: string | null; id?: string | null; tax_id?: string | null } | null | undefined
  po: { name?: string | null; id?: string | null; tax_id?: string | null } | null | undefined
  /** evidence for a field of a side ('bill' | 'purchase_order'), by its key; undefined when the side carries no such field */
  ev: (side: 'bill' | 'purchase_order', key: 'name' | 'id' | 'tax_id', value: string) => Evidence
}): { claim: ClaimVerdict } | { notRun: string } {
  const bill = sideOf(x.bill), po = sideOf(x.po)
  if (empty(po)) return { notRun: VENDOR_NOT_RUN }
  const fields = (side: 'bill' | 'purchase_order', s: VendorSide): Evidence[] => (['name', 'id', 'tax_id'] as const).flatMap((k) => (s[k] !== null ? [x.ev(side, k, s[k]!)] : []))
  const evidence = [...fields('bill', bill), ...fields('purchase_order', po)]
  const B = vendorLabel(bill), P = vendorLabel(po)
  if (empty(bill)) {
    return { claim: open(FORMULA_STRUCTURED, { bill_vendor: null, po_vendor: P, vendor_match: 'unknown' }, evidence, 'FIELD_MISSING',
      `the bill names no vendor; the order was placed with ${P}: ${WHO}`, ['/bill/vendor/name']) }
  }
  const m = compareVendors(bill, po)
  const operands = { bill_vendor: B, po_vendor: P, vendor_match: m.match }
  if (m.match === 'same' || m.match === 'variant') {
    const how = m.match === 'same' && m.basis === 'the same vendor name' ? '' : ` (${m.basis})`
    const explanation = B === P ? `The bill is from the purchase order's vendor, ${P}${how}.` : `The bill is from ${B}, the purchase order's vendor ${P}${how}.`
    return { claim: { ...base, outcome: 'PASS', asserted: B, computation: { formula: FORMULA_STRUCTURED, operands, result: P }, evidence, locked: true, explanation } }
  }
  if (m.match === 'unknown') {
    const missing = [...(po.name === null && bill.name !== null ? ['/purchase_order/vendor/name'] : []), ...(bill.name === null && po.name !== null ? ['/bill/vendor/name'] : [])]
    return { claim: open(FORMULA_STRUCTURED, operands, evidence, 'FIELD_MISSING',
      `the bill names its vendor as ${B} and the purchase order as ${P}, and ${m.basis} (a name, a vendor id or a tax id on both would settle it): ${WHO}`, missing.length ? missing : ['/bill/vendor']) }
  }
  return { claim: open(FORMULA_STRUCTURED, operands, evidence, 'AMBIGUOUS_REFERENCE', `the bill is from ${B}; the order was placed with ${P} (${m.basis}): ${WHO}`) }
}

// ── the text path ─────────────────────────────────────────────────────────────────────────────────────────────────────

const SUFFIXES = new Set(['inc', 'incorporated', 'llc', 'ltd', 'limited', 'co', 'company', 'corp', 'corporation', 'gmbh', 'sa', 'plc', 'llp', 'lp'])
/** A text's words as the duplicate check reads a vendor name: NFKC, lower case, "&" as "and", periods, commas, apostrophes dropped. */
const words = (s: string): string[] => s.normalize('NFKC').toLowerCase().replace(/&/g, ' and ').replace(/[.,'’]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean)
const core = (name: string): string[] => { const w = words(name); while (w.length > 1 && SUFFIXES.has(w[w.length - 1]!)) w.pop(); return w }
/** Equal, or equal once two neighbouring characters are swapped back (a scanning or typing slip; never a dropped or changed letter). */
function sameOrSwapped(a: string, b: string): boolean {
  if (a === b) return true
  if (a.length !== b.length || a.length < 2) return false
  const diff: number[] = []
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { diff.push(i); if (diff.length > 2) return false }
  return diff.length === 2 && diff[1] === diff[0]! + 1 && a[diff[0]!] === b[diff[1]!] && a[diff[1]!] === b[diff[0]!]
}
/**
 * The most vendor words a label can be written from, in order (the first whole or cut to 4+ letters, each later one whole, cut,
 * or left out), or 0 when it cannot be. builtFrom is this being at least 1.
 */
function builtCount(label: string, w: readonly string[]): number {
  const memo = new Map<string, number>()
  const go = (p: number, k: number): number => {
    const key = `${p},${k}`
    const hit = memo.get(key)
    if (hit !== undefined) return hit
    let r = -1
    if (p === label.length) r = k > 0 ? 0 : -1
    else if (k < w.length) {
      const word = w[k]!
      for (let n = word.length; n >= 1; n--) {
        if (k === 0 && n < Math.min(4, word.length)) break
        if (label.startsWith(word.slice(0, n), p)) { const rest = go(p + n, k + 1); if (rest >= 0) r = Math.max(r, rest + 1) }
      }
      if (k > 0) r = Math.max(r, go(p, k + 1))
    }
    memo.set(key, r)
    return r
  }
  return Math.max(0, go(0, 0))
}
const builtFrom = (label: string, w: readonly string[]): boolean => builtCount(label, w) > 0
/**
 * Engine 0.6.0: company-form words a vendor's domain may carry beside its name ("acmecorp", "acme-group",
 * "acmeusa"): such a domain is still built from the name. Anything else added ("payments", "billing", "invoices") is not.
 */
const DOMAIN_FORMS = ['incorporated', 'international', 'corporation', 'company', 'limited', 'global', 'group', 'online', 'corp', 'intl', 'inc', 'llc', 'ltd', 'grp', 'usa', 'co', 'hq', 'us', 'uk']
/** A string made only of company-form words, or nothing. */
function onlyForms(s: string): boolean {
  if (s === '') return true
  return DOMAIN_FORMS.some((f) => s.startsWith(f) && onlyForms(s.slice(f.length)))
}
/** Built from the vendor's words, with company-form words before or after allowed ("acmecorp", "theacme"). */
function builtWithForms(label: string, w: readonly string[]): boolean {
  for (let a = 0; a <= label.length; a++) {
    const pre = label.slice(0, a)
    if (pre !== '' && pre !== 'the' && !onlyForms(pre)) continue
    for (let b = label.length; b > a; b--) if (onlyForms(label.slice(b)) && builtFrom(label.slice(a, b), w)) return true
  }
  return false
}
/**
 * The fewest edits (a letter inserted, dropped or changed) that turn `label` into some name built from the vendor's words:
 * 0 when it is built. A small automaton walk, no list of every build.
 */
function buildDistance(label: string, w: readonly string[]): number {
  const n = w.length
  const idx: number[][] = []
  let S = 0
  for (let k = 0; k < n; k++) { const row: number[] = []; for (let c = 0; c <= w[k]!.length; c++) row.push(S++); idx.push(row) }
  const FINAL = S++
  const INF = 1e9
  const minFirst = Math.min(4, w[0]?.length ?? 0)
  const relax = (d: number[]): void => {
    for (let k = 0; k < n; k++) {
      for (let c = 0; c <= w[k]!.length; c++) {
        const v = d[idx[k]![c]!]!
        if (v >= INF) continue
        if (c < w[k]!.length) { const t = idx[k]![c + 1]!; if (v + 1 < d[t]!) d[t] = v + 1 }
        if (k > 0 || c >= minFirst) { const t = k + 1 < n ? idx[k + 1]![0]! : FINAL; if (v < d[t]!) d[t] = v }
      }
    }
  }
  if (!n) return INF
  let cur: number[] = new Array<number>(S).fill(INF)
  cur[idx[0]![0]!] = 0
  relax(cur)
  for (const ch of label) {
    const nxt: number[] = new Array<number>(S).fill(INF)
    for (let k = 0; k < n; k++) {
      for (let c = 0; c <= w[k]!.length; c++) {
        const s = idx[k]![c]!, v = cur[s]!
        if (v >= INF) continue
        if (v + 1 < nxt[s]!) nxt[s] = v + 1
        if (c < w[k]!.length) { const t = idx[k]![c + 1]!; const cost = w[k]![c] === ch ? 0 : 1; if (v + cost < nxt[t]!) nxt[t] = v + cost }
      }
    }
    if (cur[FINAL]! + 1 < nxt[FINAL]!) nxt[FINAL] = cur[FINAL]! + 1
    relax(nxt)
    cur = nxt
  }
  return cur[FINAL]!
}
/**
 * The part of `label` built from the vendor's words with something else around it, and that something; or null. The part is six
 * letters or more: a shorter build ("nort" + "h" inside "northwind", for Northfield Material Handling) says nothing.
 */
function containedBuild(label: string, w: readonly string[]): { name: string; extra: string } | null {
  for (let len = label.length - 1; len >= 6; len--) {
    for (let a = 0; a + len <= label.length; a++) {
      const s = label.slice(a, a + len)
      const count = builtCount(s, w)
      if (!count) continue
      const extra = `${label.slice(0, a)} ${label.slice(a + len)}`.trim()
      if (onlyForms(extra.replace(/\s+/g, ''))) continue
      return { name: s, extra }
    }
  }
  return null
}
/** A string as written, and with each one neighbouring pair swapped (one scanning or typing slip, never two). */
function oneSwap(s: string): string[] {
  const out = [s]
  for (let i = 0; i + 1 < s.length; i++) if (s[i] !== s[i + 1]) out.push(s.slice(0, i) + s[i + 1] + s[i] + s.slice(i + 2))
  return out
}
/** Second-level labels under a two-letter country code that are part of the public suffix ("shop.co.uk": the domain is shop). */
const SUFFIX2 = new Set(['co', 'com', 'net', 'org', 'gov', 'ac', 'edu', 'ltd', 'plc', 'or', 'ne', 'go', 'gen', 'biz'])
/**
 * An address's domain: the host, its registrable label (the one left of the public suffix: "aldinejan" in ar@billing.aldinejan.com,
 * "evil" in ar@aldinejan.com.evil.co), the labels left of it, and the registrable domain written out.
 */
export function domainOf(address: string): { host: string; registrable: string; sub: string[]; domain: string } | null {
  const at = address.lastIndexOf('@')
  const host = (at >= 0 ? address.slice(at + 1) : address).toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/[/?#].*$/, '').replace(/^www\./, '').replace(/\.$/, '')
  const labels = host.split('.').filter(Boolean)
  if (labels.length < 2) return null
  const two = labels.length >= 3 && labels[labels.length - 1]!.length === 2 && SUFFIX2.has(labels[labels.length - 2]!)
  const cut = labels.length - (two ? 2 : 1)
  return { host, registrable: labels[cut - 1]!, sub: labels.slice(0, cut - 1), domain: labels.slice(cut - 1).join('.') }
}
const bare = (label: string): string => label.replace(/-/g, '')
/** An address writes from a domain built from the vendor's words (its registrable label): as written, or with one neighbouring pair swapped. */
function addressBuilt(address: string, w: readonly string[]): boolean {
  for (const v of oneSwap(address.toLowerCase())) {
    const d = domainOf(v)
    if (d && v.indexOf('@') >= 1 && bare(d.registrable).length >= 2 && builtWithForms(bare(d.registrable), w)) return true
  }
  return false
}

/** The ending right of a domain's registrable name: "com" in aldinejan.com, "co.uk" in shop.co.uk. */
const suffixOf = (d: { domain: string; registrable: string }): string => d.domain.slice(d.registrable.length + 1)
/** Insertions, deletions and changes only (a swap of two neighbours counts two: it is a typing slip, read back by oneSwap). */
function lev(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[b.length]!
}
/** An ending one letter off .com: ".co", ".cm", ".om", ".con" (a letter dropped, added or changed; a swap such as ".ocm" is a slip). */
export const endingOffCom = (suffix: string): boolean => !suffix.includes('.') && suffix !== 'com' && lev(suffix, 'com') === 1
/**
 * Each hyphen of a domain name is the vendor's own: where its name has a hyphen ("pryce-webb" for "Pryce-Webb Supply"), where its
 * name has a space between two words written whole ("example-vendor" for "Example Vendor"), or before company-form words only
 * after a whole word ("acme-group"). A hyphen against a word cut short ("aldine-jan" for "Aldine Janitorial") or before another
 * word ("aldinejan-billing") is not.
 */
function hyphensFromName(label: string, vendor: string, v070 = false): boolean {
  if (!label.includes('-')) return true
  const compact = vendor.normalize('NFKC').toLowerCase().replace(/&/g, 'and').replace(/[^\p{L}\p{N}-]+/gu, '')
  const w = core(vendor)
  const parts = label.split('-')
  for (let k = 0; k + 1 < parts.length; k++) {
    const L = parts.slice(0, k + 1).join(''), R = parts.slice(k + 1).join('')
    const left = parts[k]!.slice(-3), right = parts[k + 1]!.slice(0, 3)
    if (left && right && compact.includes(`${left}-${right}`)) continue
    // engine 0.7.0: a hyphen is the vendor's own only where its name carries one. "gulfcoast-supply.com" for "Gulf Coast Supply"
    // (a hyphen where the name has a space) and "acme-group.com" for "Acme" are the cheapest look-alikes there are
    if (v070) return false
    if (w.some((x, i) => i + 1 < w.length && L.endsWith(x) && R.startsWith(w[i + 1]!))) continue
    if (w.some((x) => L.endsWith(x)) && onlyForms(R)) continue
    return false
  }
  return true
}
/**
 * With no domain on file: how a sender's domain stands to the vendor's name. 'built' when it is the name run together (one
 * neighbouring pair swapped is read back), a hyphen only where the name has one, under an ending not one letter off .com; a
 * look-alike, with the words that say why, when it is built from the name but with a hyphen the name lacks or such an ending;
 * null when it is not built from the name at all (the look-alike rules below then read it).
 */
function senderShape(address: string, w: readonly string[], vendor: string, v070 = false, swaps = true): 'built' | { lookalike: string } | null {
  if (!w.length) return null
  const d0 = domainOf(address.toLowerCase())
  if (!d0) return null
  // a swap read back (a scanning slip, "aldineja.ncom") counts only when it lands on .com itself, so an ending one letter off
  // .com (".co") never passes by a swap within it (".oc")
  const offCom = endingOffCom(suffixOf(d0))
  let built = false
  for (const v of swaps ? oneSwap(address.toLowerCase()) : [address.toLowerCase()]) {
    const d = domainOf(v)
    if (!d || v.indexOf('@') < 1 || bare(d.registrable).length < 2 || !builtWithForms(bare(d.registrable), w)) continue
    built = true
    if (!hyphensFromName(d.registrable, vendor, v070)) continue
    const sfx = suffixOf(d)
    if (offCom ? sfx !== 'com' : endingOffCom(sfx)) continue
    return 'built'
  }
  if (!built) return null
  if (!hyphensFromName(d0.registrable, vendor, v070)) return { lookalike: `${d0.domain} writes a name built from ${vendor}'s with a hyphen the vendor's name does not carry ("${d0.registrable}")` }
  if (offCom) return { lookalike: `${d0.domain} is a name built from ${vendor}'s under .${suffixOf(d0)}, one letter off .com` }
  return { lookalike: `${d0.domain} reads as a name built from ${vendor}'s only with letters moved into an ending one letter off .com` }
}

/**
 * Free-mail providers: anyone can open an address at one in any name. Read by the registrable name whatever the ending
 * (gmail.com, yahoo.co.uk), and by whole domain where the name alone says too little (me.com, mail.com).
 */
export const FREE_MAIL: { names: readonly string[]; domains: readonly string[] } = {
  names: ['gmail', 'googlemail', 'outlook', 'hotmail', 'live', 'msn', 'yahoo', 'ymail', 'rocketmail', 'aol', 'icloud', 'protonmail', 'gmx', 'yandex', 'zohomail', 'mailinator'],
  domains: ['me.com', 'mac.com', 'mail.com', 'proton.me', 'pm.me', 'tuta.io', 'tutanota.com', 'fastmail.com', 'hey.com', 'zoho.com', 'mail.ru', 'inbox.com', 'hushmail.com', 'aim.com', 'qq.com', '163.com', '126.com',
    'comcast.net', 'att.net', 'sbcglobal.net', 'verizon.net', 'bellsouth.net', 'earthlink.net', 'cox.net', 'charter.net', 'optonline.net'],
}
/** The free-mail domain an address writes from, or null. */
export function freeMailOf(address: string): string | null {
  const d = domainOf(address)
  if (!d) return null
  return FREE_MAIL.names.includes(d.registrable) || FREE_MAIL.domains.includes(d.domain) ? d.domain : null
}
/** A sender line: its first word reads "From" (a colon anywhere in it, or none; one neighbouring pair swapped allowed). */
const isFromLine = (text: string): boolean => {
  const m = /^\s*([A-Za-z:]{4,6})(?=\s|$)/.exec(text)
  return m !== null && sameOrSwapped(m[1]!.replace(/:/g, '').toLowerCase(), 'from')
}
/**
 * Engine 0.6.0: an email header line other than the sender's ("Subject:", "To:", "Cc:", "Date:", "Re:", "Fwd:"),
 * read with one neighbouring pair swapped as the sender line is. The person who sends a bill writes these, so a vendor's name in
 * one is never evidence of who the vendor is (the attacker's "Subject: Fwd: Aldine Janitorial invoice" was cited as the vendor).
 */
const HEADER_WORDS = ['subject', 'to', 'cc', 'bcc', 'date', 'sent', 're', 'fwd', 'fw', 'reply-to']
const isHeaderLine = (text: string): boolean => {
  const m = /^\s*([A-Za-z-]{2,9})\s*:/.exec(text)
  return m !== null && HEADER_WORDS.some((h) => sameOrSwapped(m[1]!.toLowerCase(), h))
}
const FORWARD_MARK = /forwarded message|original message|begin forwarded/i

export interface TextLine { text: string; start: number; line: number }
const linesOf = (text: string): TextLine[] => {
  const out: TextLine[] = []
  let pos = 0
  text.split('\n').forEach((t, i) => { out.push({ text: t, start: pos, line: i + 1 }); pos += t.length + 1 })
  return out
}
const ADDRESS = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g

/** The address a From line was sent from: the one in angle brackets, or after "mailto:" in square brackets. */
const BRACKETED = /<\s*([A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)\s*>|\[\s*mailto:\s*([A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)\s*\]/i
/** Quoted text and parenthesized comments on a From line: a display name, or a comment, never the address it was sent from. */
const SHOWN = /"[^"]*"|“[^”]*”|\([^()]*\)/g
/**
 * Engine 0.7.0: what a From line says. The address it was sent from is the one in angle brackets (or "[mailto:...]"); with
 * none, every address outside quotes and parentheses. An address-shaped display name ("billing@vendor.com" in quotes before
 * another address in brackets) is what the sender chose to show, never the sender.
 */
function fromLineReading(text: string): { senders: string[]; shown: string[] } {
  const b = BRACKETED.exec(text)
  if (b) {
    const rest = `${text.slice(0, b.index)} ${text.slice(b.index + b[0].length)}`
    return { senders: [(b[1] ?? b[2])!], shown: [...rest.matchAll(ADDRESS)].map((m) => m[0]) }
  }
  const shown = [...text.matchAll(SHOWN)].flatMap((q) => [...q[0].matchAll(ADDRESS)].map((m) => m[0]))
  return { senders: [...text.replace(SHOWN, ' ').matchAll(ADDRESS)].map((m) => m[0]), shown }
}

/** A display name shaped like an address that is not the address the line was sent from (engine 0.7.0). */
interface ShownAddress { shown: string; sender: string | null; line: TextLine }

/**
 * Every sender's address on the invoice, in order, with its line; and which of them sent the bill (the first after a forward
 * marker). Engine 0.7.0 (`v070`): a From line's sender is the address in angle brackets, and an address-shaped display name
 * that differs from it is listed apart (`shown`), never as a sender. Earlier engines read every address on a From line as a
 * sender, as before.
 */
function sendersOf(invoice: string, v070 = false): { senders: { address: string; line: TextLine }[]; original: { address: string; line: TextLine } | null; shown: ShownAddress[] } {
  const lines = linesOf(invoice)
  const senders: { address: string; line: TextLine }[] = []
  const shown: ShownAddress[] = []
  let mark = -1
  lines.forEach((l, i) => { if (FORWARD_MARK.test(l.text)) mark = i })
  for (const l of lines) {
    if (!isFromLine(l.text)) continue
    if (!v070) { for (const m of l.text.matchAll(ADDRESS)) senders.push({ address: m[0], line: l }); continue }
    const r = fromLineReading(l.text)
    for (const s of r.senders) senders.push({ address: s, line: l })
    for (const d of r.shown) if (!r.senders.some((s) => s.toLowerCase() === d.toLowerCase())) shown.push({ shown: d, sender: r.senders[0] ?? null, line: l })
  }
  const after = senders.find((s) => s.line.line - 1 > mark)
  return { senders, original: mark >= 0 ? after ?? senders[senders.length - 1] ?? null : senders[0] ?? null, shown }
}

/** A closing on a line of its own ("Thank you," "Regards," "Sincerely,"): what follows it is the signature. */
const CLOSING = /^\s*(?:thank\s+you(?:\s+for\s+your\s+business)?|thanks(?:\s+again)?|many\s+thanks|(?:best|kind|warm|warmest)\s+regards|regards|best(?:\s+wishes)?|sincerely(?:\s+yours)?|yours\s+(?:truly|sincerely|faithfully)|respectfully|cheers)\s*[,.!]?\s*$/i
/**
 * Engine 0.7.0: the line numbers of the bill's signature blocks: a closing on a line of its own and every line after it, up to
 * a forward marker or the end; or the lines after a "-- " signature delimiter. The sender writes them, as it writes the header
 * lines, so a vendor's name in one is never evidence of who the vendor is.
 */
export function signatureLines(invoice: string): Set<number> {
  const out = new Set<number>()
  let inSig = false
  for (const l of linesOf(invoice)) {
    if (FORWARD_MARK.test(l.text)) { inSig = false; continue }
    if (!inSig && (CLOSING.test(l.text) || /^--\s*$/.test(l.text))) inSig = true
    if (inSig) out.add(l.line)
  }
  return out
}

/** The vendor's domain when the purchase order names one ("Email: ar@aldinejan.com", "Domain: aldinejan.com", "Website: ..."). */
const PO_DOMAIN = /\b(?:vendor\s+)?(?:e-?mail|domain|web(?:site)?|remit\s+e-?mail)\s*:\s*([^\s|,;]+)/i
export function poDomainOf(purchaseOrder: string): { domain: string; registrable: string; written: string; line: TextLine } | null {
  for (const l of linesOf(purchaseOrder)) {
    const m = PO_DOMAIN.exec(l.text)
    if (!m) continue
    const d = domainOf(m[1]!)
    if (d) return { domain: d.domain, registrable: bare(d.registrable), written: m[1]!, line: l }
  }
  return null
}

/**
 * A domain on file for the vendor: the purchase order's (its "Email:", "Domain:" or "Website:" field), or the address a booked
 * bill of this vendor came from (a history row's `sender`). `address` is set when what is on file is an email address.
 */
export interface OnFileDomain { domain: string; registrable: string; raw: string; written: string; address: string | null; where: 'purchase order' | 'history'; evidence: Evidence; label: string }

/**
 * The vendor's domains on file: the purchase order's when it names one (it is the order's own word, and wins); else the senders
 * of this vendor's booked bills (history rows whose vendor is this one by normalized name and that carry a `sender`), each
 * domain once.
 */
function onFileDomains(x: { purchase_order: string; vendor: string; history?: readonly PriorInvoice[] | undefined
  poEv: (line: TextLine, written: string) => Evidence; historyEv?: ((i: number, value: string) => Evidence) | undefined }): OnFileDomain[] {
  const po = poDomainOf(x.purchase_order)
  if (po) {
    const raw = domainOf(po.written)?.registrable ?? po.registrable
    return [{ domain: po.domain, registrable: po.registrable, raw, written: po.written, address: po.written.includes('@') ? po.written : null, where: 'purchase order', evidence: x.poEv(po.line, po.written), label: 'the domain the purchase order names' }]
  }
  const out: OnFileDomain[] = []
  const name = normalizeVendorName(x.vendor)
  ;(x.history ?? []).forEach((h, i) => {
    if (typeof h.sender !== 'string' || !h.vendor || normalizeVendorName(h.vendor) !== name) return
    const m = h.sender.match(new RegExp(ADDRESS.source))
    const d = m ? domainOf(m[0]) : null
    if (!m || !d || out.some((o) => o.domain === d.domain && (freeMailOf(o.written) === null || o.address?.toLowerCase() === m[0].toLowerCase()))) return
    const evidence: Evidence = x.historyEv ? x.historyEv(i, h.sender) : { locator: { kind: 'field', source: 'history', path: `history[${i}].sender` }, value: h.sender, confidence: 100, role: 'REFERENCE' }
    out.push({ domain: d.domain, registrable: bare(d.registrable), raw: d.registrable, written: m[0], address: m[0], where: 'history', evidence, label: `the domain booked invoice ${h.invoice_number} came from` })
  })
  return out
}

/** How a sender's domain stands to the vendor, and why: in the words a person reads. */
type SenderRelation =
  | { rel: 'built' | 'other' }
  | { rel: 'on-file'; ref: OnFileDomain }
  | { rel: 'lookalike'; basis: string }
function senderRelation(address: string, vendor: string, w: readonly string[], refs: readonly OnFileDomain[], v070 = false): SenderRelation {
  const d = domainOf(address)
  if (!d) return { rel: 'other' }
  const reg = bare(d.registrable)
  if (refs.length) {
    for (const r of refs) {
      // a free-mail address on file is the vendor's only as that exact address; anyone can open another at the same provider
      if (freeMailOf(r.written) !== null ? r.address !== null && address.toLowerCase() === r.address.toLowerCase()
        : (v070 ? [address.toLowerCase()] : oneSwap(address.toLowerCase())).some((v) => domainOf(v)?.domain === r.domain)) return { rel: 'on-file', ref: r }
    }
    for (const r of refs) {
      if (freeMailOf(r.written) !== null) continue
      const where = r.label
      // engine 0.7.0: the domain on file with two neighbouring letters swapped is a look-alike, not a scanning slip read back
      if (v070 && oneSwap(address.toLowerCase()).some((v) => domainOf(v)?.domain === r.domain)) return { rel: 'lookalike', basis: `${d.domain} is ${where}, ${r.domain}, with two neighbouring letters swapped` }
      if (reg === r.registrable) {
        return { rel: 'lookalike', basis: d.registrable !== r.raw
          ? `${d.domain} is ${where}, ${r.domain}, with a hyphen ${d.registrable.includes('-') && !r.raw.includes('-') ? 'inserted' : r.raw.includes('-') && !d.registrable.includes('-') ? 'removed' : 'moved'}`
          : `${d.domain} is ${where}, ${r.domain}, under another ending (.${suffixOf(d)}, not .${suffixOf({ domain: r.domain, registrable: r.raw })})` }
      }
      const dist = editDistance(reg, r.registrable)
      if (dist >= 1 && dist <= allowedEdits(Math.max(reg.length, r.registrable.length))) return { rel: 'lookalike', basis: `${d.domain} is not ${where}, ${r.domain}: they differ by ${dist === 1 ? 'one character' : `${dist} characters`}` }
      if (w.length && builtWithForms(reg, w)) return { rel: 'lookalike', basis: `${d.domain} is built from the vendor's name, but it is not ${where}, ${r.domain}` }
      if (r.registrable.length >= 4 && (reg.includes(r.registrable) || (reg.length >= 4 && r.registrable.includes(reg)))) return { rel: 'lookalike', basis: `${d.domain} is not ${where}, ${r.domain}, but one name holds the other` }
      if (w.length && d.sub.some((s) => builtWithForms(bare(s), w) || containedBuild(bare(s), w))) return { rel: 'lookalike', basis: `the vendor's name appears only as a subdomain of ${d.domain}, which is not ${where}, ${r.domain}` }
    }
    return { rel: 'other' }
  }
  if (!w.length) return { rel: 'other' }
  // no domain on file: the vendor's name run together, a hyphen only where the name has one, an ending not one letter off .com
  const shape = senderShape(address, w, vendor, v070)
  if (shape === 'built') return { rel: 'built' }
  if (shape) return { rel: 'lookalike', basis: `${shape.lookalike}; no domain for ${vendor} is on file to compare it with (an "Email:" or "Domain:" field on the purchase order, or the sender of a booked bill, settles which domain is the vendor's)` }
  const inside = containedBuild(reg, w)
  if (inside) return { rel: 'lookalike', basis: `${d.domain} adds "${inside.extra}" to a name built from ${vendor}'s` }
  const dist = buildDistance(reg, w)
  if (dist >= 1 && dist <= allowedEdits(reg.length)) return { rel: 'lookalike', basis: `${d.domain} is ${dist === 1 ? 'one character' : `${dist} characters`} away from a name built from ${vendor}'s` }
  if (d.sub.some((s) => builtWithForms(bare(s), w) || containedBuild(bare(s), w))) return { rel: 'lookalike', basis: `${vendor}'s name appears only as a subdomain of ${d.domain}` }
  return { rel: 'other' }
}

/**
 * What the invoice text says about the order's vendor: a sender writing from a domain built from its name, a line naming it
 * (never an email header line), or neither. Engine 0.6.0: the sender's address is read first (it is the
 * stronger evidence), and a header line ("Subject: ...") never counts.
 */
export function readInvoiceVendor(invoice: string, vendor: string, v070 = false): { by: 'name'; line: TextLine; asWritten: string; swapped: boolean } | { by: 'sender address'; line: TextLine; address: string; swapped?: boolean } | { by: null; senders: string[]; senderLines: TextLine[]; signatureLine?: TextLine } {
  const w = core(vendor)
  const lines = linesOf(invoice)
  const { senders: all, original } = sendersOf(invoice, v070)
  // engine 0.7.0: a sender writing from a domain built from the name passes, as before (a forward marker garbled in scanning
  // leaves the forwarder first, so every sender is read); with senders and none built, a line naming the vendor does not count.
  // A line naming the vendor counts only when the bill names no sender at all, and never an email header line or a line of the
  // signature (the sender writes both)
  if (v070) {
    if (original) {
      if (w.length) for (const s of all) {
        if (senderShape(s.address, w, vendor, true) !== 'built') continue
        return { by: 'sender address', line: s.line, address: s.address, swapped: senderShape(s.address, w, vendor, true, false) !== 'built' }
      }
      const senderLines: TextLine[] = []
      for (const s of all) if (!senderLines.includes(s.line)) senderLines.push(s.line)
      return { by: null, senders: all.map((s) => s.address), senderLines }
    }
    const sig = signatureLines(invoice)
    let signatureLine: TextLine | undefined
    if (w.length) {
      for (const l of lines) {
        if (isFromLine(l.text) || isHeaderLine(l.text)) continue
        const t = words(l.text)
        for (let i = 0; i + w.length <= t.length; i++) {
          if (!w.every((x, k) => sameOrSwapped(t[i + k]!, x))) continue
          if (sig.has(l.line)) { signatureLine ??= l; break }
          const asWritten = t.slice(i, i + w.length).join(' ')
          return { by: 'name', line: l, asWritten, swapped: asWritten !== w.join(' ') }
        }
      }
    }
    return { by: null, senders: [], senderLines: [], ...(signatureLine ? { signatureLine } : {}) }
  }
  // 2026-10-06: built strictly (a hyphen the name lacks, or an ending one letter off .com, is a look-alike, never a match)
  if (w.length) for (const s of all) if (senderShape(s.address, w, vendor) === 'built') return { by: 'sender address', line: s.line, address: s.address }
  if (w.length) {
    for (const l of lines) {
      if (isFromLine(l.text) || isHeaderLine(l.text)) continue
      const t = words(l.text)
      for (let i = 0; i + w.length <= t.length; i++) {
        if (w.every((x, k) => sameOrSwapped(t[i + k]!, x))) {
          const asWritten = t.slice(i, i + w.length).join(' ')
          return { by: 'name', line: l, asWritten, swapped: asWritten !== w.join(' ') }
        }
      }
    }
  }
  const senderLines: TextLine[] = []
  for (const s of all) if (!senderLines.includes(s.line)) senderLines.push(s.line)
  return { by: null, senders: all.map((s) => s.address), senderLines }
}

/** How the text path's vendor check matched (for an approve's "Not checked" line), or null when it did not pass. */
export type TextVendorMatch =
  | { by: 'po domain' | 'history domain'; address: string; line: number; on_file: string }
  /** engine 0.7.0: `swapped` when the domain is built from the vendor's name only once two neighbouring letters are swapped back */
  | { by: 'sender address'; address: string; line: number; swapped?: boolean }
  /** engine 0.7.0: `noSender` when the bill names no sender at all (a line naming the vendor counts only then) */
  | { by: 'name'; line: number; senders: string[]; noSender?: boolean }

/** The text path's claim, or why it did not run (the purchase order has no "Vendor:" field); with how it matched, on a PASS. */
export function vendorClaimText(x: {
  invoice: string
  purchase_order: string
  /** evidence for a span of one of the two texts */
  ev: (src: 'invoice' | 'purchase_order', span: { start: number; end: number; line: number }, value: string, role: Evidence['role']) => Evidence
  /** 2026-10-06: the payment history, whose rows' `sender` puts this vendor's domain on file when the purchase order names none */
  history?: readonly PriorInvoice[] | undefined
  /** evidence for history row i's sender */
  historyEv?: ((i: number, value: string) => Evidence) | undefined
  /**
   * Engine 0.7.0 (./v070.ts): the sender is the address in angle brackets and a display name shaped like another address goes
   * to a person; with no domain on file, a sender whose domain is not built from the vendor's name goes to a person (a line
   * naming the vendor counts only when the bill names no sender, and never a signature line); a hyphen the vendor's name does
   * not carry is a look-alike; every sentence says what was matched, swaps included.
   */
  v070?: boolean
  /**
   * Ruleset ap-threeway 0.4.0 (the header): a check that would pass goes to a person when, with no domain on file, the sender's
   * domain is the vendor's name under another ending than .com, or when a Reply-To writes from another domain.
   */
  v040?: boolean
}): ({ claim: ClaimVerdict; matched: TextVendorMatch | null }) | { notRun: string } {
  // ruleset 0.4.0: the check as before, then the ending and the Reply-To, on a PASS only (any other finding already sends the
  // bill to a person)
  if (x.v040) return withV040(vendorClaimText({ ...x, v040: false }), x)
  const v070 = x.v070 === true
  const pl = linesOf(x.purchase_order).find((l) => /Vendor:\s*[^|\n]*\S/.test(l.text))
  const m = pl ? /Vendor:\s*([^|\n]+)/.exec(pl.text) : null
  const vendor = m?.[1]?.trim() ?? ''
  if (!pl || !m || !vendor) return { notRun: VENDOR_NOT_RUN }
  const spanOf = (l: TextLine): { start: number; end: number; line: number } => ({ start: l.start, end: l.start + l.text.length, line: l.line })
  const poEv = x.ev('purchase_order', spanOf(pl), vendor, 'REFERENCE')
  const w = core(vendor)
  // 2026-10-06: the vendor's domains on file, the purchase order's else the senders of its booked bills
  const refs = onFileDomains({ purchase_order: x.purchase_order, vendor, history: x.history, historyEv: x.historyEv,
    poEv: (line, written) => x.ev('purchase_order', spanOf(line), written, 'REFERENCE') })
  const refEv = refs.map((r) => r.evidence)
  const refOps: Record<string, string> = refs[0]?.where === 'purchase order' ? { po_domain: refs[0].domain } : refs.length ? { on_file_domain: refs.map((r) => r.domain).join(', ') } : {}
  const onFileWords = refs[0]?.where === 'purchase order' ? `the domain the purchase order names for ${vendor}` : `the domain ${vendor}'s booked bills came from`
  const { senders, original, shown } = sendersOf(x.invoice, v070)

  // engine 0.7.0: a From line whose display name is an address other than the one it was sent from is what a sender does to
  // make a bill look like the vendor's; the bill goes to a person, both addresses named
  if (v070 && shown.length) {
    const d = shown[0]!
    const sent = d.sender ?? 'no address at all (the line carries an address only as its display name)'
    const detail = `the From line shows ${d.shown} but the message was sent from ${sent} (invoice line ${d.line.line}): the name a From line shows is written by whoever sends the message, and the address in angle brackets is the one it came from. A display name shaped like another address is how a bill is made to look like someone else's: ${WHO}`
    return { claim: open(FORMULA_TEXT, { po_vendor: vendor, read_by: 'sender address', invoice_reads: d.sender, display_name: d.shown, ...(d.sender ? { sender_domain: domainOf(d.sender)?.domain ?? d.sender } : {}), vendor_match: 'display-name', ...refOps },
      [x.ev('invoice', spanOf(d.line), d.line.text.trim(), 'OPERAND'), poEv, ...refEv], 'AMBIGUOUS_REFERENCE', detail), matched: null }
  }
  // engine 0.6.0: a sender writing from a look-alike domain is a near match for the controller, whatever else
  // the bill says; it is never evidence of who sent it
  for (const s of senders) {
    const r = senderRelation(s.address, vendor, w, refs, v070)
    if (r.rel !== 'lookalike') continue
    const host = domainOf(s.address)?.host ?? s.address
    const detail = `the bill's sender, ${s.address}, writes from a look-alike of ${refs.length ? onFileWords : `the purchase order's vendor, ${vendor}`} (a look-alike vendor: ${r.basis}). A look-alike domain is never evidence of who sent a bill; it is how a bill is redirected: the controller confirms who sent this bill, and that it is payable on this order, before it is paid`
    return { claim: open(FORMULA_TEXT, { po_vendor: vendor, read_by: 'sender address', invoice_reads: s.address, sender_domain: host, vendor_match: 'near', ...refOps },
      [x.ev('invoice', spanOf(s.line), s.line.text.trim(), 'OPERAND'), poEv, ...refEv], 'AMBIGUOUS_REFERENCE', detail), matched: null }
  }
  // 2026-10-06: a free-mail sender is a person's decision, unless that exact address is on file
  const free = original ? freeMailOf(original.address) : null
  if (original && free !== null && !refs.some((r) => r.address !== null && r.address.toLowerCase() === original.address.toLowerCase())) {
    const filed = refs.length ? `${onFileWords} is ${refs.map((r) => r.written).join(', ')}` : `no domain or email for ${vendor} is on file (the purchase order names none, and no booked bill carries a sender)`
    return { claim: open(FORMULA_TEXT, { po_vendor: vendor, read_by: 'sender address', invoice_reads: original.address, sender_domain: free, vendor_match: 'free-mail', ...refOps },
      [x.ev('invoice', spanOf(original.line), original.line.text.trim(), 'OPERAND'), poEv, ...refEv], 'AMBIGUOUS_REFERENCE',
      `the bill's sender, ${original.address}, writes from a free-mail address (${free}), which anyone can open in any name; ${filed}, so nothing on file shows ${vendor} writing from that address: ${WHO}`), matched: null }
  }
  // a domain on file: the bill's sender must write from it
  if (refs.length && original) {
    const r = senderRelation(original.address, vendor, w, refs, v070)
    if (r.rel === 'on-file') {
      const fromPo = r.ref.where === 'purchase order'
      const from = r.ref.domain
      return { claim: { ...base, outcome: 'PASS', asserted: original.address, computation: { formula: FORMULA_TEXT, operands: { po_vendor: vendor, read_by: fromPo ? 'po domain' : 'history domain', invoice_reads: original.address, ...(fromPo ? { po_domain: r.ref.domain } : { on_file_domain: r.ref.domain }) }, result: vendor },
        evidence: [x.ev('invoice', spanOf(original.line), original.address, 'OPERAND'), poEv, r.ref.evidence], locked: true,
        explanation: fromPo
          ? `The invoice's sender, ${original.address}, writes from ${from}, the domain the purchase order names for its vendor, ${vendor} (invoice line ${original.line.line}).`
          : `The invoice's sender, ${original.address}, writes from ${from}, ${r.ref.label} for ${vendor} (invoice line ${original.line.line}).` },
      matched: { by: fromPo ? 'po domain' : 'history domain', address: original.address, line: original.line.line, on_file: fromPo ? 'the domain the purchase order names' : r.ref.label } }
    }
    const host = domainOf(original.address)?.domain ?? original.address
    return { claim: open(FORMULA_TEXT, { po_vendor: vendor, read_by: 'sender address', invoice_reads: original.address, sender_domain: host, vendor_match: 'different', ...refOps },
      [x.ev('invoice', spanOf(original.line), original.line.text.trim(), 'CONTEXT'), poEv, ...refEv], 'AMBIGUOUS_REFERENCE',
      refs[0]!.where === 'purchase order'
        ? `the bill's sender, ${original.address}, writes from ${host}; the purchase order names ${vendor}'s domain as ${refs[0]!.domain}. Another domain is not evidence of who sent this bill: ${WHO}`
        : `the bill's sender, ${original.address}, writes from ${host}; ${vendor}'s booked bills came from ${refs.map((r) => r.domain).join(', ')}. Another domain is not evidence of who sent this bill: ${WHO}`), matched: null }
  }
  const r = readInvoiceVendor(x.invoice, vendor, v070)
  if (r.by === 'name' || r.by === 'sender address') {
    const seen = r.by === 'name' ? r.asWritten : r.address
    const swapped = r.by === 'sender address' && r.swapped === true
    const explanation = r.by === 'name'
      ? `The invoice names the purchase order's vendor, ${vendor}${r.swapped ? `, as "${r.asWritten}" (two neighbouring letters swapped)` : ''} (invoice line ${r.line.line}).`
      : `The invoice's sender, ${r.address}, writes from a domain built from the purchase order's vendor name, ${vendor}${swapped ? ', once two neighbouring letters are swapped back' : ''} (invoice line ${r.line.line}).`
    return { claim: { ...base, outcome: 'PASS', asserted: seen, computation: { formula: FORMULA_TEXT, operands: { po_vendor: vendor, read_by: r.by, invoice_reads: seen }, result: vendor },
      evidence: [x.ev('invoice', spanOf(r.line), seen, 'OPERAND'), poEv], locked: true, explanation },
    matched: r.by === 'name' ? { by: 'name', line: r.line.line, senders: senders.map((s) => s.address), ...(v070 ? { noSender: true as const } : {}) } : { by: 'sender address', address: r.address, line: r.line.line, ...(swapped ? { swapped: true } : {}) } }
  }
  // engine 0.7.0: no domain on file, and the bill's sender writes from a domain not built from the vendor's name. A line of the
  // bill naming the vendor, its signature above all, is written by whoever sends the bill, so it is not evidence of who sent it
  if (v070 && original) {
    const host = domainOf(original.address)?.domain ?? original.address
    const senderEv = r.senderLines.map((l) => x.ev('invoice', spanOf(l), l.text.trim(), 'CONTEXT'))
    return { claim: open(FORMULA_TEXT, { po_vendor: vendor, read_by: 'sender address', invoice_reads: original.address, sender_domain: host, vendor_match: 'not-built' }, [...senderEv, poEv], 'AMBIGUOUS_REFERENCE',
      `the bill's sender, ${original.address}, writes from ${host}, which is not built from the purchase order's vendor name, ${vendor}, and no domain for ${vendor} is on file (an "Email:" or "Domain:" field on the purchase order, or the sender of a booked bill, settles which domain is the vendor's); a line of the bill or its signature naming the vendor is written by whoever sends it, so it is not evidence of who sent the bill: ${WHO}`), matched: null }
  }
  const who = r.senders.length ? `the bill's sender is ${r.senders.join(', ')}` : 'the bill names no sender'
  // the sender lines the reader compares with the order's vendor (CONTEXT: read, not matched)
  const senderEv = r.senderLines.map((l) => x.ev('invoice', spanOf(l), l.text.trim(), 'CONTEXT'))
  if (v070) {
    const sig = 'signatureLine' in r ? r.signatureLine : undefined
    const sigEv = sig ? [x.ev('invoice', spanOf(sig), sig.text.trim(), 'CONTEXT')] : []
    return { claim: open(FORMULA_TEXT, { po_vendor: vendor, read_by: null, invoice_reads: null }, [...sigEv, poEv], 'AMBIGUOUS_REFERENCE',
      `${who}; the order was placed with ${vendor}, and no line of the invoice names it apart from an email header or the signature${sig ? ` (invoice line ${sig.line})` : ''}, which whoever sends a bill writes: ${WHO}`), matched: null }
  }
  return { claim: open(FORMULA_TEXT, { po_vendor: vendor, read_by: null, invoice_reads: r.senders.join(', ') || null }, [...senderEv, poEv], 'AMBIGUOUS_REFERENCE',
    `${who}; the order was placed with ${vendor}, and the invoice does not name it (no line other than an email header carries the name, and no sender's domain is built from it): ${WHO}`), matched: null }
}

/** Ruleset 0.4.0: a Reply-To header line of the bill, the address it names, and the From of its header block (or the sender). */
export interface ReplyToReading { reply: string; line: TextLine; from: { address: string; line: TextLine } | null }
const REPLY_TO = /^\s*reply[\s-]?to\s*:/i

/**
 * Ruleset 0.4.0: every Reply-To line of the bill, in order: the address it names (the one in angle brackets, else the first
 * outside quotes and parentheses), and the From line of its own header block, the nearest From line above it, else below it,
 * with no blank line between; else the bill's sender (the first after a forward marker, else the first).
 */
export function replyTosOf(invoice: string): ReplyToReading[] {
  const lines = linesOf(invoice)
  const { original } = sendersOf(invoice, true)
  const out: ReplyToReading[] = []
  lines.forEach((l, i) => {
    if (!REPLY_TO.test(l.text)) return
    const reply = fromLineReading(l.text.replace(REPLY_TO, ' ')).senders[0]
    if (!reply) return
    let from: { address: string; line: TextLine } | null = null
    for (const dir of [-1, 1]) {
      for (let k = i + dir; k >= 0 && k < lines.length && lines[k]!.text.trim() !== ''; k += dir) {
        if (!isFromLine(lines[k]!.text)) continue
        const s = fromLineReading(lines[k]!.text).senders[0]
        if (s) from = { address: s, line: lines[k]! }
        break
      }
      if (from) break
    }
    out.push({ reply, line: l, from: from ?? original })
  })
  return out
}
/** Ruleset 0.4.0: the first Reply-To that writes from another registrable domain than the From of its header block, or null. */
function replyToElsewhere(invoice: string): (ReplyToReading & { from: { address: string; line: TextLine } }) | null {
  for (const r of replyTosOf(invoice)) {
    const a = domainOf(r.reply), b = r.from ? domainOf(r.from.address) : null
    if (r.from && a && b && a.domain !== b.domain) return r as ReplyToReading & { from: { address: string; line: TextLine } }
  }
  return null
}

const FORMULA_TEXT_040 = `${FORMULA_TEXT}; a Reply-To writes from the domain of the address the bill was sent from`

/**
 * Ruleset 0.4.0: the ending of a sender's domain built from the vendor's name: "net" for ar@aldinejan.net, "co.uk" for
 * ar@aldinejan.co.uk. As senderShape reads a scanning slip, one neighbouring pair swapped back that lands the domain on .com
 * counts as .com ("castellantools.cmo", "hallamsuppl.ycom"); otherwise the ending is the one the address is built under.
 */
function builtEnding(address: string, vendor: string): string | null {
  const w = core(vendor)
  let first: string | null = null
  for (const v of oneSwap(address.toLowerCase())) {
    const d = domainOf(v)
    if (!d || v.indexOf('@') < 1 || bare(d.registrable).length < 2 || !builtWithForms(bare(d.registrable), w)) continue
    const sfx = suffixOf(d)
    if (sfx === 'com') return 'com'
    first ??= sfx
  }
  return first
}

/**
 * Ruleset 0.4.0: the claim of vendorClaimText, when it passes, held to two more readings (the header above):
 *   - with no domain on file, a sender whose domain is the vendor's name run together passes under .com only. Under another
 *     ending (.net, .org, a country ending) a person decides: which ending is the vendor's own cannot be told from the bill
 *     until a domain is on file (the purchase order's "Email:" or "Domain:" field, or a booked bill's sender);
 *   - a Reply-To at another domain than the From line of its header block (replyToElsewhere).
 */
function withV040(r: ({ claim: ClaimVerdict; matched: TextVendorMatch | null }) | { notRun: string }, x: Parameters<typeof vendorClaimText>[0]): ({ claim: ClaimVerdict; matched: TextVendorMatch | null }) | { notRun: string } {
  if ('notRun' in r || r.claim.outcome !== 'PASS') return r
  const pl = linesOf(x.purchase_order).find((l) => /Vendor:\s*[^|\n]*\S/.test(l.text))!
  const vendor = /Vendor:\s*([^|\n]+)/.exec(pl.text)![1]!.trim()
  const spanOf = (l: TextLine): { start: number; end: number; line: number } => ({ start: l.start, end: l.start + l.text.length, line: l.line })
  const poEv = x.ev('purchase_order', spanOf(pl), vendor, 'REFERENCE')
  // the ending: a pass on a sender's address built from the vendor's name is made only with no domain on file
  if (r.matched?.by === 'sender address') {
    const addr = r.matched.address
    const sfx = builtEnding(addr, vendor)
    if (sfx !== null && sfx !== 'com') {
      const line = linesOf(x.invoice).find((l) => l.line === (r.matched as { line: number }).line)!
      const host = domainOf(addr)?.domain ?? addr
      const detail = `the bill's sender, ${addr} (invoice line ${line.line}), writes from ${host}, a name built from ${vendor}'s under .${sfx}, not .com, and no domain for ${vendor} is on file (an "Email:" or "Domain:" field on the purchase order, or the sender of a booked bill, settles which domain is the vendor's): the vendor's name under another ending is the cheapest look-alike there is, and which ending is the vendor's own cannot be told from the bill. A person decides: the controller confirms who sent this bill, and that it is payable on this order, by a phone number already on file (never one given in the bill or its email), before it is paid`
      return { claim: open(FORMULA_TEXT_040, { po_vendor: vendor, read_by: 'sender address', invoice_reads: addr, sender_domain: host, vendor_match: 'near' },
        [x.ev('invoice', spanOf(line), line.text.trim(), 'OPERAND'), poEv], 'AMBIGUOUS_REFERENCE', detail), matched: null }
    }
  }
  const m = replyToElsewhere(x.invoice)
  if (!m) return { ...r, claim: { ...r.claim, ...(r.claim.computation ? { computation: { ...r.claim.computation, formula: FORMULA_TEXT_040 } } : {}) } }
  const rd = domainOf(m.reply)!.domain, fd = domainOf(m.from.address)!.domain
  const detail = `the bill's Reply-To, ${m.reply} (invoice line ${m.line.line}), writes from ${rd}, not from ${fd}, the domain of the address the bill was sent from, ${m.from.address} (invoice line ${m.from.line.line}): a reply to this bill goes to ${rd}, not to the sender, and a Reply-To at another domain is how a payment conversation is moved away from the vendor's own mailbox. A person decides: the controller confirms who sent this bill, and that it is payable on this order, by a phone number already on file (never one given in the bill or its email), before it is paid`
  return { claim: open(FORMULA_TEXT_040, { po_vendor: vendor, read_by: 'reply-to', invoice_reads: m.reply, reply_to_domain: rd, sender: m.from.address, sender_domain: fd, vendor_match: 'reply-to' },
    [x.ev('invoice', spanOf(m.line), m.line.text.trim(), 'OPERAND'), x.ev('invoice', spanOf(m.from.line), m.from.line.text.trim(), 'CONTEXT'), x.ev('purchase_order', spanOf(pl), vendor, 'REFERENCE')],
    'AMBIGUOUS_REFERENCE', detail), matched: null }
}

/** True when the text path's vendor check would pass on these texts (or does not run: the purchase order names no vendor). */
export function textVendorPasses(invoice: string, purchase_order: string, history?: readonly PriorInvoice[], v070 = false, v040 = false): boolean {
  const ev = (): Evidence => ({ locator: { kind: 'field', source: 'invoice', path: '' }, value: null, confidence: 100, role: 'CONTEXT' })
  const r = vendorClaimText({ invoice, purchase_order, ev, history, v070, ...(v040 ? { v040: true } : {}) })
  return 'notRun' in r || r.claim.outcome === 'PASS'
}

/**
 * The not_checked line an approve carries about the vendor's identity on the text path (2026-10-06): how the vendor was
 * matched, what it was compared with, and what that does not show. Engine 0.7.0 adds a domain built from the vendor's name read
 * with two neighbouring letters swapped back, and a bill that names no sender, in so many words.
 */
export function textVendorNotChecked(m: TextVendorMatch): string {
  if (m.by === 'name') return `vendor identity: matched by a line of the bill naming the vendor (invoice line ${m.line}); ${m.noSender ? 'the bill names no sender, so ' : m.senders.length ? `no sender's address (${m.senders.join(', ')}) is built from the vendor's name, so ` : ''}who sent the bill was not checked`
  if (m.by === 'po domain' || m.by === 'history domain') return `vendor identity: the sender, ${m.address}, writes from ${m.on_file}; that the email was not forged, and that the vendor record is genuine, were not checked`
  return `vendor identity: matched by the sender's address, ${m.address} (invoice line ${m.line}), whose domain is the vendor's name run together${'swapped' in m && m.swapped ? ' once two neighbouring letters are swapped back' : ''}; no domain for the vendor is on file (none on the purchase order, no sender on a booked bill), so it was compared with names built from the vendor's name only, and that this is the vendor's own domain, that the sender owns it, and that the vendor record is genuine were not checked`
}

/**
 * Ruleset 0.4.0: the same line, saying whether the bill carried a Reply-To line and, when it did, that it writes from the
 * sender's domain (a Reply-To at another domain sends the bill to a person, so an approve never carries one).
 */
export function textVendorNotChecked040(m: TextVendorMatch, invoice: string): string {
  // 2026-10-20: a sender built from the vendor's name passes under .com only, so the approve says the ending was read
  const base = m.by === 'sender address' ? textVendorNotChecked(m).replace("whose domain is the vendor's name run together", "whose domain is the vendor's name run together under .com") : textVendorNotChecked(m)
  const rs = replyTosOf(invoice)
  if (!rs.length) return `${base}; the bill carries no Reply-To line`
  const same = rs.filter((r) => r.from && domainOf(r.reply)?.domain === domainOf(r.from.address)?.domain).map((r) => r.reply)
  const unread = rs.filter((r) => !r.from).map((r) => r.reply)
  return `${base}${same.length ? `; its Reply-To ${same.join(', ')} write${same.length === 1 ? 's' : ''} from the domain of the address the bill was sent from` : ''}${unread.length ? `; its Reply-To ${unread.join(', ')} was not compared with a sender, as the bill names none` : ''}`
}

/** The not_checked line an approve carries about the vendor's identity on the structured path (2026-10-06). */
export function structuredVendorNotChecked(claim: ClaimVerdict | undefined): string | null {
  if (!claim || claim.outcome !== 'PASS') return null
  const m = String(claim.computation?.operands?.vendor_match ?? '')
  const how = /tax id/.test(claim.explanation) ? 'by tax id' : /vendor id/.test(claim.explanation) ? 'by vendor id' : m === 'variant' ? 'by name (case, spacing, punctuation or a company suffix aside)' : 'by name'
  return `vendor identity: the bill's vendor was matched to the purchase order's ${how}; who sent the bill, and whether the vendor record is genuine, were not checked (the structured input carries no sender)`
}

/**
 * Remedies for AP_VENDOR_MATCH (engine 0.6.0's AP table, ./index.ts AP_REMEDIES_V060). A bill whose vendor is not the order's is
 * the controller's to clear, for this verdict only; the vendor id or tax id on both documents settles a name that only looks
 * alike or two records under one name.
 */
export const VENDOR_REMEDIES: RuleRemedies = {
  abstain: [
    { kind: 'authority', authority: 'ap-controller', when: ['AMBIGUOUS_REFERENCE', 'FIELD_MISSING'],
      detail: 'The bill and its purchase order name different vendors. The controller confirms who sent the bill and that it is payable on this order (a vendor that changed its name, or a bill from a distributor the order names), for this verdict only.' },
    { kind: 'missing-operand', operand: { source: 'invoice', path: 'vendor' }, when: ['AMBIGUOUS_REFERENCE', 'FIELD_MISSING'],
      detail: 'The vendor id or tax id on both the bill and the purchase order settles whether they are one supplier: supply it on both, and the check runs again.' },
  ],
}
