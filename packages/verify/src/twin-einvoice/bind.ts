/**
 * Binding: profile detection, and for one mapped field the ONE binding element, its concrete XPath, its span in the
 * XML string, and its value parsed by kind. Agent-independent: this is what the invoice itself says.
 */
import { kids, positionOf, type XmlElement, type XmlSpan } from './xml.js'
import {
  EINVOICE_MAPS, KSEF_NS, UBL_NS, breakdownTotals, lineElements, vatBreakdownElements,
  type EinvoiceFieldMap, type EinvoiceMap, type EinvoiceProfile, type FieldKind, type SourceKey,
} from './map.js'

/** PEPPOL-EN16931-R004: CustomizationID starts with this (after normalize-space). */
export const PEPPOL_BIS3_CUSTOMIZATION = 'urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0'
/** ZATCA BR-KSA-EN16931-01: Business process (BT-23, cbc:ProfileID) must be "reporting:1.0". */
export const ZATCA_PROFILE_ID = 'reporting:1.0'

export interface ProfileDetection { profile: EinvoiceProfile | null; detail: string }

const ws = (s: string): string => s.replace(/\s+/g, ' ').trim()

/** Which declared profile a parsed document is, from its own markers. null = not one we map (the claim abstains). */
export function detectProfile(root: XmlElement): ProfileDetection {
  if (root.ns === UBL_NS.inv && root.local === 'Invoice') {
    const cust = ws(kids(root, UBL_NS.cbc, 'CustomizationID')[0]?.text ?? '')
    const prof = ws(kids(root, UBL_NS.cbc, 'ProfileID')[0]?.text ?? '')
    if (cust.startsWith(PEPPOL_BIS3_CUSTOMIZATION)) return { profile: 'peppol-bis3', detail: `cbc:CustomizationID "${cust}" (PEPPOL-EN16931-R004)` }
    if (prof === ZATCA_PROFILE_ID) return { profile: 'zatca-ksa', detail: `cbc:ProfileID "${prof}" (BR-KSA-EN16931-01)` }
    return { profile: null, detail: `a UBL Invoice that is neither Peppol BIS 3.0 (CustomizationID "${cust}") nor ZATCA (ProfileID "${prof}")` }
  }
  if (root.local === 'CreditNote' && root.ns === 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2') {
    return { profile: null, detail: 'a UBL CreditNote: not mapped in this version (only the UBL Invoice root is)' }
  }
  if (root.local === 'Faktura') {
    if (root.ns !== KSEF_NS) return { profile: null, detail: `a KSeF Faktura in namespace ${root.ns}, not FA(3) (${KSEF_NS})` }
    const kf = kids(kids(root, KSEF_NS, 'Naglowek')[0] ?? root, KSEF_NS, 'KodFormularza')[0]
    const sys = kf?.attrs.kodSystemowy
    if (sys !== 'FA (3)') return { profile: null, detail: `a FA(3)-namespace Faktura whose Naglowek/KodFormularza/@kodSystemowy is ${JSON.stringify(sys ?? null)}, not "FA (3)"` }
    return { profile: 'ksef-fa3', detail: 'Faktura in the FA(3) namespace, KodFormularza kodSystemowy="FA (3)"' }
  }
  return { profile: null, detail: `root element {${root.ns}}${root.local} is not a mapped e-invoice` }
}

export interface EinvoiceBinding {
  field: string
  term: string
  name: string
  source: SourceKey
  kind: FieldKind
  /** the map's generic XPath */
  declared_xpath: string
  /** the concrete XPath of this element in this document (1-based positions where siblings repeat) */
  xpath: string
  /** the element's character content, entities decoded and untrimmed (the span holds it exactly as written) */
  raw: string
  /** parsed by kind; null when the content does not parse (the binding then abstains) */
  value: number | string | null
  /** UBL amounts: the element's @currencyID */
  currency?: string
  /** the element's content span in the XML string (what the value was read from) */
  span: XmlSpan
}

export type BindFailure = 'ELEMENT_ABSENT' | 'AMBIGUOUS_ELEMENT' | 'BINDING_UNPARSEABLE'
export type BindResult =
  | { ok: true; binding: EinvoiceBinding }
  | { ok: false; reason: BindFailure; detail: string; binding?: EinvoiceBinding }

const PREFIX: Record<string, string> = { [UBL_NS.cac]: 'cac', [UBL_NS.cbc]: 'cbc' }

/** The concrete XPath of an element, using the maps' conventional prefixes (root and KSeF elements unprefixed). */
export function xpathOf(el: XmlElement): string {
  const parts: string[] = []
  for (let e: XmlElement | null = el; e; e = e.parent) {
    const p = PREFIX[e.ns]
    const { index, of } = positionOf(e)
    parts.unshift(`${p ? `${p}:` : ''}${e.local}${of > 1 ? `[${index}]` : ''}`)
  }
  return '/' + parts.join('/')
}

const DECIMAL = /^[+-]?(\d+(\.\d*)?|\.\d+)$/
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/

export function parseDecimal(s: string): number | null {
  const t = s.trim()
  return DECIMAL.test(t) ? Number(t) : null
}
/** A calendar-valid YYYY-MM-DD, else null. */
export function parseIsoDate(s: string): string | null {
  const t = s.trim()
  const m = DATE.exec(t)
  if (!m) return null
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? t : null
}
export function parseTime(s: string): string | null { const t = s.trim(); return TIME.test(t) ? t : null }

export function parseByKind(kind: FieldKind, raw: string): number | string | null {
  switch (kind) {
    case 'amount': case 'quantity': case 'rate': return parseDecimal(raw)
    case 'date': return parseIsoDate(raw)
    case 'time': return parseTime(raw)
    default: { const t = raw.trim(); return t.length ? t : null }
  }
}

export interface ScopeRef { scope: 'document' | 'line' | 'vat_breakdown'; index: number }

/** The element a scoped field binds within: the document root, the index-th line, or the index-th VAT breakdown. */
export function scopeRoot(map: EinvoiceMap, root: XmlElement, ref: ScopeRef): { el: XmlElement } | { el: null; reason: BindFailure; detail: string } {
  if (ref.scope === 'document') return { el: root }
  if (ref.scope === 'line') {
    const ls = lineElements(map, root)
    return ls[ref.index] ? { el: ls[ref.index]! } : { el: null, reason: 'ELEMENT_ABSENT', detail: `the invoice has ${ls.length} line(s) (${map.lineXpath}); there is no line index ${ref.index} (0-based)` }
  }
  const tt = breakdownTotals(root)
  if (tt !== 1) return { el: null, reason: tt === 0 ? 'ELEMENT_ABSENT' : 'AMBIGUOUS_ELEMENT', detail: `the VAT breakdown lives in the one cac:TaxTotal with cac:TaxSubtotal; this invoice has ${tt}` }
  const vb = vatBreakdownElements(map, root)
  return vb[ref.index] ? { el: vb[ref.index]! } : { el: null, reason: 'ELEMENT_ABSENT', detail: `the invoice has ${vb.length} VAT breakdown(s); there is no index ${ref.index} (0-based)` }
}

/** Bind one mapped field in one scope. */
export function bindField(map: EinvoiceMap, root: XmlElement, fm: EinvoiceFieldMap, ref: ScopeRef): BindResult {
  const sr = scopeRoot(map, root, ref)
  if (!sr.el) return { ok: false, reason: sr.reason, detail: sr.detail }
  const els = fm.select(sr.el, root)
  const where = ref.scope === 'document' ? fm.xpath : `${fm.xpath} (${ref.scope}[${ref.index}])`
  if (els.length === 0) return { ok: false, reason: 'ELEMENT_ABSENT', detail: `the invoice has no ${where} (${fm.term} ${fm.name})` }
  if (els.length > 1) return { ok: false, reason: 'AMBIGUOUS_ELEMENT', detail: `the invoice has ${els.length} elements for ${where} (${fm.term}); one is required to bind: ${els.map(xpathOf).join(', ')}` }
  const el = els[0]!
  const binding: EinvoiceBinding = {
    field: fm.field, term: fm.term, name: fm.name, source: fm.source, kind: fm.kind, declared_xpath: fm.xpath, xpath: xpathOf(el),
    raw: el.text, value: parseByKind(fm.kind, el.text), span: { ...el.inner },
    ...(el.attrs.currencyID !== undefined ? { currency: el.attrs.currencyID.trim() } : {}),
  }
  if (el.children.length) return { ok: false, reason: 'BINDING_UNPARSEABLE', detail: `${binding.xpath} has child elements; a ${fm.kind} leaf was expected`, binding }
  if (binding.value === null) return { ok: false, reason: 'BINDING_UNPARSEABLE', detail: `${binding.xpath} reads ${JSON.stringify(el.text)}, which is not a valid ${fm.kind}`, binding }
  // BT-110 must be in the document currency (CEN BR-CO-15 selects TaxAmount[@currencyID = DocumentCurrencyCode]).
  if (fm.term === 'BT-110') {
    const docCur = ws(kids(root, UBL_NS.cbc, 'DocumentCurrencyCode')[0]?.text ?? '')
    if (!docCur || binding.currency !== docCur) {
      return { ok: false, reason: 'AMBIGUOUS_ELEMENT', detail: `the tax total with a breakdown (${binding.xpath}) is in ${binding.currency ?? '(no currencyID)'}, but BT-110 is the one in the document currency ${docCur || '(none stated)'}; the two selections disagree`, binding }
    }
  }
  // BT-111 exists only with a VAT accounting currency (BT-6): PEPPOL-EN16931-R054 requires a tax total without subtotals
  // iff cbc:TaxCurrencyCode is present (count(cac:TaxTotal[not(cac:TaxSubtotal)]) = (if (cbc:TaxCurrencyCode) then 1 else 0)).
  // Without BT-6 such an element is not BT-111, so the field is not bound (E-INVOICE-2, found by the R054 unit tests).
  if (fm.term === 'BT-111' && kids(root, UBL_NS.cbc, 'TaxCurrencyCode').length === 0) {
    return { ok: false, reason: 'AMBIGUOUS_ELEMENT', detail: `${binding.xpath} is a tax total without a breakdown, but the invoice states no VAT accounting currency (BT-6, cbc:TaxCurrencyCode); BT-111 exists only with BT-6 (PEPPOL-EN16931-R054), so it is not bound as BT-111`, binding }
  }
  return { ok: true, binding }
}

export function mapFor(profile: EinvoiceProfile): EinvoiceMap { return EINVOICE_MAPS[profile] }
