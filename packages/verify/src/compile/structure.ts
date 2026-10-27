/**
 * The document structure the compiler maps XPath onto (2026-10-03): a table of absolute UBL paths, each with its
 * cardinality, the EN 16931 business terms it binds (BT / BG ids), the term's name and any default the structure states.
 * The table is read from a tab-separated file, one row per element or attribute:
 *
 *   path <TAB> cardinality <TAB> BT ids <TAB> name <TAB> default <TAB> rules
 *   /Invoice/cac:LegalMonetaryTotal/cbc:PayableAmount	1..1	BT-115	Amount due for payment		BR-15,BR-CO-16,…
 *
 * (the Peppol BIS 3.0 structure, flattened; `docs/COMPILER.md`). A row whose BT column names two terms ("BT-110, BT-111",
 * "BT-92,BT-99") is a UBL element that carries two EN 16931 terms; `dualIndex` below says which one a path means.
 */

import { childElements, parseXml, textContent, type XmlElement } from './xml.js'

export interface Card { min: number; max: number }
export interface StructureRow {
  path: string
  card: Card
  /** BT / BG ids, in the order the row lists them */
  terms: string[]
  name: string
  /** the structure's stated default (e.g. "VAT" for a tax scheme id), when it states one */
  default?: string
}

export interface Structure {
  /** the document's root element name, e.g. "Invoice" */
  root: string
  rows: ReadonlyMap<string, StructureRow>
  /** paths the table could not list (e.g. a part that was not fetched), by the prefix under which they are missing */
  gaps: string[]
}

const parseCard = (s: string): Card => {
  const m = /^(\d+)\.\.(\d+|n)$/.exec(s.trim())
  if (!m) return { min: 1, max: 1 }
  return { min: Number(m[1]), max: m[2] === 'n' ? Infinity : Number(m[2]) }
}

/** Read a structure table (TSV). Rows that are not paths (comments, headers, unfetched parts) are recorded as gaps. */
export function parseStructureTsv(text: string): Structure {
  const rows = new Map<string, StructureRow>()
  const gaps: string[] = []
  let root = ''
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.startsWith('#')) continue
    const cols = raw.split('\t')
    const path = (cols[0] ?? '').trim()
    if (!path.startsWith('/')) continue
    if (/<include|NOT FETCHED/.test(path)) { gaps.push(path); continue }
    if (!root) root = path.split('/')[1] ?? ''
    const terms = (cols[2] ?? '').split(',').map(x => x.trim()).filter(x => /^B[TG]-/.test(x))
    const def = /DEFAULT=(.*)$/.exec((cols[4] ?? '').trim())?.[1]?.trim()
    rows.set(path, { path, card: parseCard(cols[1] ?? ''), terms, name: (cols[3] ?? '').trim(), ...(def !== undefined ? { default: def } : {}) })
  }
  return { root, rows, gaps }
}

/**
 * Read a structure from its published XML (the VEFA "structure-1" format the Peppol BIS repositories publish, e.g.
 * `structure/syntax/ubl-invoice.xml` with its `part/*.xml` includes): Document → Element (Term, Name, cardinality,
 * Reference type="BUSINESS_TERM", Value type="DEFAULT") → Attribute (Term, Name, usage="Optional"), recursively.
 * `readPart(href)` returns an included part's text; a part it cannot read is recorded as a gap, as the TSV records it.
 */
export function parseStructureXml(text: string, readPart?: (href: string) => string | undefined): Structure {
  const rows = new Map<string, StructureRow>()
  const gaps: string[] = []
  const kids = (el: XmlElement, local: string): XmlElement[] => childElements(el).filter(c => c.local === local)
  const first = (el: XmlElement, local: string): string => { const c = kids(el, local)[0]; return c ? textContent(c).trim() : '' }
  const doc = parseXml(text)
  const document = kids(doc, 'Document')[0]
  if (!document) throw new Error('not a structure document (no <Document>)')
  const rootTerm = first(document, 'Term')
  const root = rootTerm.replace(/^[\w-]+:/, '')
  const walk = (el: XmlElement, parent: string): void => {
    for (const c of childElements(el)) {
      if (c.local === 'Include') {
        const href = textContent(c).trim()
        const t = readPart?.(href)
        if (t === undefined) { gaps.push(`${parent}/<include ${href} NOT FETCHED>`); continue }
        const part = parseXml(t)
        if (part.local === 'Element') visitElement(part, parent)
        else walk(part, parent)
        continue
      }
      if (c.local === 'Element') visitElement(c, parent)
      if (c.local === 'Attribute') {
        const p = `${parent}/@${first(c, 'Term')}`
        const terms = kids(c, 'Reference').filter(r => r.attrs.type === 'BUSINESS_TERM').flatMap(r => textContent(r).split(',').map(x => x.trim()).filter(Boolean))
        const def = kids(c, 'Value').find(v => v.attrs.type === 'DEFAULT')
        rows.set(p, { path: p, card: c.attrs.usage === 'Optional' ? { min: 0, max: 1 } : { min: 1, max: 1 }, terms, name: first(c, 'Name'), ...(def ? { default: textContent(def).trim() } : {}) })
      }
    }
  }
  const visitElement = (el: XmlElement, parent: string): void => {
    const p = `${parent}/${first(el, 'Term')}`
    const terms = kids(el, 'Reference').filter(r => r.attrs.type === 'BUSINESS_TERM').flatMap(r => textContent(r).split(',').map(x => x.trim()).filter(Boolean))
    const def = kids(el, 'Value').find(v => v.attrs.type === 'DEFAULT')
    rows.set(p, { path: p, card: parseCard(el.attrs.cardinality ?? '1..1'), terms, name: first(el, 'Name'), ...(def ? { default: textContent(def).trim() } : {}) })
    walk(el, p)
  }
  walk(document, `/${root}`)
  return { root, rows, gaps }
}

export const parentPath = (p: string): string => p.slice(0, p.lastIndexOf('/'))
export const lastStep = (p: string): string => p.slice(p.lastIndexOf('/') + 1)
/** "cbc:PayableAmount" → "PayableAmount"; "@currencyID" → "currencyID" */
export const localOf = (step: string): string => step.replace(/^@/, '').replace(/^[\w-]+:/, '')

/** Children of a path (elements and attributes), in table order. */
export function childrenOf(s: Structure, p: string): string[] {
  const out: string[] = []
  for (const k of s.rows.keys()) if (parentPath(k) === p) out.push(k)
  return out
}

/** Every path whose trailing steps equal `steps` (a relative match pattern), in table order. '*' matches any element. */
export function pathsEndingWith(s: Structure, steps: string[]): string[] {
  const out: string[] = []
  for (const k of [`/${s.root}`, ...s.rows.keys()]) {
    const parts = k.split('/').slice(1)
    if (parts.length < steps.length) continue
    const tail = parts.slice(parts.length - steps.length)
    // the root name matches only at the root
    if (steps[0] === s.root && parts.length !== steps.length) continue
    if (tail.every((t, i) => steps[i] === '*' ? !t.startsWith('@') : t === steps[i])) if (!out.includes(k)) out.push(k)
  }
  return out
}

export const hasPath = (s: Structure, p: string): boolean => p === `/${s.root}` || s.rows.has(p)

/** The cardinality of each step from the root down to `p` (the root itself is 1..1). */
export function chain(s: Structure, p: string): { path: string; card: Card }[] {
  const parts = p.split('/').slice(1)
  const out: { path: string; card: Card }[] = []
  for (let i = 1; i <= parts.length; i++) {
    const q = `/${parts.slice(0, i).join('/')}`
    out.push({ path: q, card: i === 1 ? { min: 1, max: 1 } : (s.rows.get(q)?.card ?? { min: 1, max: 1 }) })
  }
  return out
}

/** The nearest ancestor-or-self of `p` that repeats (max > 1), below `below` (exclusive), or undefined. */
export function repeatingAncestor(s: Structure, p: string, below = ''): string | undefined {
  let found: string | undefined
  for (const c of chain(s, p)) if (c.path.length > below.length && c.path.startsWith(below) && c.card.max > 1) found = c.path
  return found
}

/** True when `p` occurs at most once per instance of `from` (no repeating element strictly below `from` down to `p`). */
export function singleUnder(s: Structure, from: string, p: string): boolean {
  if (!p.startsWith(from)) return false
  return chain(s, p).every(c => c.path.length <= from.length || c.card.max <= 1)
}

/** True when the element is optional where it stands: its own minimum is 0, or an optional ancestor below `from` holds it. */
export function optionalUnder(s: Structure, from: string, p: string): boolean {
  return chain(s, p).some(c => c.path.length > from.length && c.card.min === 0)
}

// ── UBL's dual-term elements ─────────────────────────────────────────────────────────────────────────────────────────────
//
// One UBL element sometimes carries two EN 16931 terms, and the structure lists both on one row:
//  - cac:AllowanceCharge: an allowance (cbc:ChargeIndicator false) is the first term, a charge (true) the second
//    (BG-20/BG-21, BT-92/BT-99, BT-136/BT-141, …);
//  - cac:TaxTotal (1..2): the instance with the VAT breakdown, in the invoice currency, carries the first term (BT-110); the
//    one in the VAT accounting currency, the second (BT-111).
// These are the two bindings the Peppol BIS states for these rows. Any other two-term row is read as one combined term
// and the compiler says so.

export type DualChoice = { index: number; why: string } | { index: undefined; why: string }

/**
 * Which of a two-term row's terms a path means, given what the path's predicates say about the discriminator. `facts`
 * are the discriminator values the compiler read off the predicates: the ChargeIndicator ('true' | 'false') of the
 * nearest cac:AllowanceCharge, and whether the cac:TaxTotal is the one with a breakdown or in the invoice currency.
 */
export function dualIndex(path: string, facts: { chargeIndicator?: 'true' | 'false'; taxTotal?: 'document' | 'accounting' }): DualChoice {
  if (/\/cac:AllowanceCharge(\/|$)/.test(path)) {
    if (facts.chargeIndicator === 'false') return { index: 0, why: 'cbc:ChargeIndicator = false: an allowance' }
    if (facts.chargeIndicator === 'true') return { index: 1, why: 'cbc:ChargeIndicator = true: a charge' }
    return { index: undefined, why: 'cac:AllowanceCharge without a ChargeIndicator predicate: an allowance or a charge' }
  }
  if (/\/cac:TaxTotal(\/|$)/.test(path)) {
    if (facts.taxTotal === 'accounting') return { index: 1, why: 'the cac:TaxTotal in the VAT accounting currency (BT-111)' }
    if (facts.taxTotal === 'document') return { index: 0, why: 'the cac:TaxTotal with the VAT breakdown, in the invoice currency (BT-110)' }
    return { index: 0, why: 'the first cac:TaxTotal (BT-110); the VAT total in accounting currency (BT-111) is not read' }
  }
  return { index: undefined, why: 'the UBL element binds two terms; read as one' }
}
