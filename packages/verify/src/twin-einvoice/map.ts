/**
 * The declared field maps: which BINDING XML element each extracted field means, per e-invoice profile.
 *
 * Every entry names its business term and the PRIMARY source it was verified against (fetched 2026-09-28; see
 * SOURCES). A field that is not in a profile's map is NOT_MAPPED for that profile and abstains: never guessed.
 * A field is mapped only where the source states the element for that term. Where two profiles use the same
 * element (ZATCA conforms to EN 16931), each is still listed from its own source.
 *
 * Selection rules (stated, because they are where a twin can bind the wrong element):
 *   - A document-level field binds exactly ONE element. None → ELEMENT_ABSENT. Several → AMBIGUOUS_ELEMENT.
 *   - `lines[i].f` binds inside the i-th (0-based, document order) line element; `vat_breakdown[i].f` inside the
 *     i-th VAT breakdown (BG-23) of the tax total that carries the breakdown.
 *   - UBL BT-110 (Invoice total VAT amount) is the cac:TaxTotal WITH cac:TaxSubtotal, and BT-111 (in accounting
 *     currency) the one WITHOUT (PEPPOL-EN16931-R053/R054; ZATCA BR-KSA-EN16931-08/09). BT-110 must also carry the
 *     document currency (CEN BR-CO-15 selects cbc:TaxAmount[@currencyID = cbc:DocumentCurrencyCode]); if the two
 *     selections disagree, the field abstains (AMBIGUOUS_ELEMENT).
 *   - UBL BT-31 / BT-48 (VAT identifier) is cac:PartyTaxScheme[cac:TaxScheme/cbc:ID = 'VAT']/cbc:CompanyID
 *     (CEN-EN16931-UBL.sch uses normalize-space(upper-case(cbc:ID)) = 'VAT'); BT-32 is the one with ID != 'VAT'.
 *   - UBL BT-111 binds only when the invoice states BT-6 (cbc:TaxCurrencyCode): PEPPOL-EN16931-R054 (bind.ts).
 *
 * Map version 0.2.0 (2026-09-28, E-INVOICE-2): the twin's behaviour changed under the same field list. BT-111 needs
 * BT-6; the footing reads line allowances / charges and runs the shipped rulesets unchanged (consistency.ts). The
 * footing ruleset's own id@version is also bound into every verdict's input (judge.ts einvoiceVerdictInput).
 *
 * Map version 0.3.0 (2026-09-29, PRODUCT-FIX-1): the verdict's outcome rule changed under the same field list. PASS now
 * needs at least one verified extracted value; a passing footing alone is INSUFFICIENT_DATA (judge.ts, and
 * docs/EINVOICE-TWIN-CORRECTION-2026-09-29.md). Bindings and per-claim judgments are unchanged.
 */
import { kids, type XmlElement } from './xml.js'

export type EinvoiceProfile = 'peppol-bis3' | 'zatca-ksa' | 'ksef-fa3'
export type FieldKind = 'amount' | 'quantity' | 'rate' | 'date' | 'time' | 'identifier' | 'code' | 'text'
export type FieldScope = 'document' | 'line' | 'vat_breakdown'

/** Primary sources, keyed. The URL is what was fetched at build time (2026-09-28); nothing is fetched at runtime. */
export const SOURCES = {
  'PEPPOL-SYNTAX': 'Peppol BIS Billing 3.0 (May 2026 release), UBL Invoice syntax: https://docs.peppol.eu/poacc/billing/3.0/syntax/ubl-invoice/tree/ (source: github.com/OpenPEPPOL/peppol-bis-invoice-3 structure/syntax/ubl-invoice.xml + part/*.xml)',
  'PEPPOL-RULES': 'Peppol BIS Billing 3.0 rules: https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-tc434/ (EN 16931 BR-CO-*) and rules/sch/PEPPOL-EN16931-UBL.sch (R053, R054, R120)',
  'CEN-SCH': 'CEN EN 16931 UBL schematron as shipped with Peppol BIS 3.0: github.com/OpenPEPPOL/peppol-bis-invoice-3 rules/sch/CEN-EN16931-UBL.sch (BR-CO-10..16 asserts)',
  'ZATCA-DD': 'ZATCA Electronic Invoice Data Dictionary v1.2 (2023-05-19): https://zatca.gov.sa/ar/E-Invoicing/SystemsDevelopers/Documents/20230519_EInvoice_Data_Dictionary%20vF.xlsx',
  'ZATCA-XML': 'ZATCA Electronic Invoice XML Implementation Standard v1.2 (2023-05-19): https://zatca.gov.sa/ar/E-Invoicing/SystemsDevelopers/Documents/20230519_ZATCA_Electronic_Invoice_XML_Implementation_Standard_%20vF.pdf',
  'KSEF-XSD': 'KSeF FA(3) schema, namespace http://crd.gov.pl/wzor/2025/06/25/13775/: http://crd.gov.pl/wzor/2025/06/25/13775/schemat.xsd (element documentation)',
  'KSEF-MF': 'MF, Broszura informacyjna dotycząca struktury logicznej FA(3), 2026-03-04: https://ksef.podatki.gov.pl/media/jknpcymf/broszura-informacyjna-dotyczaca-struktury-logicznej-fa-3-04032026.pdf',
} as const
export type SourceKey = keyof typeof SOURCES

export interface EinvoiceFieldMap {
  /** the claim field; for scoped fields the bare name (the claim writes `lines[0].net_amount`) */
  field: string
  scope: FieldScope
  /** the business term: BT-115, KSA-12, or the KSeF element name */
  term: string
  /** the source's own name for the term */
  name: string
  /** the declared (generic) XPath, with the profile's conventional prefixes */
  xpath: string
  kind: FieldKind
  source: SourceKey
  /** the element(s) this field binds, from the scope root (the document root, a line, or a VAT breakdown) */
  select: (scopeRoot: XmlElement, doc: XmlElement) => XmlElement[]
  /** the other party's field of the same kind, for the SWAPPED_PARTY diagnosis */
  counterpart?: string
}

export interface EinvoiceMap {
  /** doubles as the verdict's ruleset id / version / domain */
  id: string
  version: string
  domain: 'e-invoice'
  profile: EinvoiceProfile
  /** prefix → namespace URI for the declared XPaths */
  namespaces: Record<string, string>
  /** the line element and the VAT-breakdown element (null when the profile has none) */
  lineXpath: string
  vatBreakdownXpath: string | null
  fields: readonly EinvoiceFieldMap[]
}

export const UBL_NS = {
  inv: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
  cac: 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
  cbc: 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
} as const
export const KSEF_NS = 'http://crd.gov.pl/wzor/2025/06/25/13775/'

// ---- selection helpers ---------------------------------------------------------------------------------------

type Step = string | ((el: XmlElement) => XmlElement[])
/** Walk child steps ("cac:Party" etc. resolved against `ns`), collecting every match in document order. */
function walk(from: XmlElement[], steps: readonly Step[], ns: Record<string, string>): XmlElement[] {
  let cur = from
  for (const s of steps) {
    if (typeof s === 'function') { cur = cur.flatMap(s); continue }
    const c = s.indexOf(':')
    const uri = c > 0 ? ns[s.slice(0, c)] : ''
    if (uri === undefined) throw new Error(`map: unknown prefix in step ${s}`)
    const local = c > 0 ? s.slice(c + 1) : s
    cur = cur.flatMap((e) => kids(e, uri, local))
  }
  return cur
}
const ubl = (...steps: Step[]) => (root: XmlElement): XmlElement[] => walk([root], steps, UBL_NS)
const ksef = (...steps: Step[]) => (root: XmlElement): XmlElement[] => walk([root], steps, { k: KSEF_NS })

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim()
const taxSchemeId = (pts: XmlElement): string => norm(walk([pts], ['cac:TaxScheme', 'cbc:ID'], UBL_NS)[0]?.text ?? '').toUpperCase()
/** cac:PartyTaxScheme[cac:TaxScheme/cbc:ID = 'VAT'] (BT-31 / BT-48) or != 'VAT' (BT-32) */
const vatScheme = (want: boolean) => (party: XmlElement): XmlElement[] =>
  kids(party, UBL_NS.cac, 'PartyTaxScheme').filter((p) => (taxSchemeId(p) === 'VAT') === want)
/** the tax total that carries the VAT breakdown (BT-110) or the one without (BT-111) */
const taxTotal = (withSubtotal: boolean) => (root: XmlElement): XmlElement[] =>
  kids(root, UBL_NS.cac, 'TaxTotal').filter((t) => (kids(t, UBL_NS.cac, 'TaxSubtotal').length > 0) === withSubtotal)

const SUPPLIER: Step[] = ['cac:AccountingSupplierParty', 'cac:Party']
const CUSTOMER: Step[] = ['cac:AccountingCustomerParty', 'cac:Party']
const LMT = 'cac:LegalMonetaryTotal'

type F = Omit<EinvoiceFieldMap, 'scope'> & { scope?: FieldScope }
const doc = (f: F): EinvoiceFieldMap => ({ scope: 'document', ...f })
const line = (f: F): EinvoiceFieldMap => ({ ...f, scope: 'line' })
const vbd = (f: F): EinvoiceFieldMap => ({ ...f, scope: 'vat_breakdown' })

// ---- UBL fields shared by Peppol BIS 3.0 and ZATCA (each profile lists them from its own source) --------------

function ublCore(src: SourceKey, lineX: string): EinvoiceFieldMap[] {
  return [
    doc({ field: 'invoice_number', term: 'BT-1', name: 'Invoice number', xpath: '/Invoice/cbc:ID', kind: 'identifier', source: src, select: ubl('cbc:ID') }),
    doc({ field: 'issue_date', term: 'BT-2', name: 'Invoice issue date', xpath: '/Invoice/cbc:IssueDate', kind: 'date', source: src, select: ubl('cbc:IssueDate') }),
    doc({ field: 'invoice_type_code', term: 'BT-3', name: 'Invoice type code', xpath: '/Invoice/cbc:InvoiceTypeCode', kind: 'code', source: src, select: ubl('cbc:InvoiceTypeCode') }),
    doc({ field: 'currency', term: 'BT-5', name: 'Invoice currency code', xpath: '/Invoice/cbc:DocumentCurrencyCode', kind: 'code', source: src, select: ubl('cbc:DocumentCurrencyCode') }),
    doc({ field: 'tax_currency', term: 'BT-6', name: 'VAT accounting currency code', xpath: '/Invoice/cbc:TaxCurrencyCode', kind: 'code', source: src, select: ubl('cbc:TaxCurrencyCode') }),
    doc({ field: 'purchase_order_reference', term: 'BT-13', name: 'Purchase order reference', xpath: '/Invoice/cac:OrderReference/cbc:ID', kind: 'identifier', source: src, select: ubl('cac:OrderReference', 'cbc:ID') }),
    doc({ field: 'contract_reference', term: 'BT-12', name: 'Contract reference', xpath: '/Invoice/cac:ContractDocumentReference/cbc:ID', kind: 'identifier', source: src, select: ubl('cac:ContractDocumentReference', 'cbc:ID') }),
    doc({ field: 'seller_name', term: 'BT-27', name: 'Seller name', xpath: '/Invoice/cac:AccountingSupplierParty/cac:Party/cac:PartyLegalEntity/cbc:RegistrationName', kind: 'text', source: src, select: ubl(...SUPPLIER, 'cac:PartyLegalEntity', 'cbc:RegistrationName'), counterpart: 'buyer_name' }),
    doc({ field: 'seller_vat_id', term: 'BT-31', name: 'Seller VAT identifier', xpath: "/Invoice/cac:AccountingSupplierParty/cac:Party/cac:PartyTaxScheme[cac:TaxScheme/cbc:ID='VAT']/cbc:CompanyID", kind: 'identifier', source: src, select: ubl(...SUPPLIER, vatScheme(true), 'cbc:CompanyID'), counterpart: 'buyer_vat_id' }),
    doc({ field: 'buyer_name', term: 'BT-44', name: 'Buyer name', xpath: '/Invoice/cac:AccountingCustomerParty/cac:Party/cac:PartyLegalEntity/cbc:RegistrationName', kind: 'text', source: src, select: ubl(...CUSTOMER, 'cac:PartyLegalEntity', 'cbc:RegistrationName'), counterpart: 'seller_name' }),
    doc({ field: 'buyer_vat_id', term: 'BT-48', name: 'Buyer VAT identifier', xpath: "/Invoice/cac:AccountingCustomerParty/cac:Party/cac:PartyTaxScheme[cac:TaxScheme/cbc:ID='VAT']/cbc:CompanyID", kind: 'identifier', source: src, select: ubl(...CUSTOMER, vatScheme(true), 'cbc:CompanyID'), counterpart: 'seller_vat_id' }),
    doc({ field: 'sum_of_line_net_amount', term: 'BT-106', name: 'Sum of Invoice line net amount', xpath: `/Invoice/${LMT}/cbc:LineExtensionAmount`, kind: 'amount', source: src, select: ubl(LMT, 'cbc:LineExtensionAmount') }),
    doc({ field: 'allowance_total_amount', term: 'BT-107', name: 'Sum of allowances on document level', xpath: `/Invoice/${LMT}/cbc:AllowanceTotalAmount`, kind: 'amount', source: src, select: ubl(LMT, 'cbc:AllowanceTotalAmount') }),
    doc({ field: 'charge_total_amount', term: 'BT-108', name: 'Sum of charges on document level', xpath: `/Invoice/${LMT}/cbc:ChargeTotalAmount`, kind: 'amount', source: src, select: ubl(LMT, 'cbc:ChargeTotalAmount') }),
    doc({ field: 'tax_exclusive_amount', term: 'BT-109', name: 'Invoice total amount without VAT', xpath: `/Invoice/${LMT}/cbc:TaxExclusiveAmount`, kind: 'amount', source: src, select: ubl(LMT, 'cbc:TaxExclusiveAmount') }),
    doc({ field: 'tax_amount', term: 'BT-110', name: 'Invoice total VAT amount', xpath: '/Invoice/cac:TaxTotal[cac:TaxSubtotal]/cbc:TaxAmount', kind: 'amount', source: src, select: ubl(taxTotal(true), 'cbc:TaxAmount') }),
    doc({ field: 'tax_amount_accounting_currency', term: 'BT-111', name: 'Invoice total VAT amount in accounting currency', xpath: '/Invoice/cac:TaxTotal[not(cac:TaxSubtotal)]/cbc:TaxAmount', kind: 'amount', source: src, select: ubl(taxTotal(false), 'cbc:TaxAmount') }),
    doc({ field: 'tax_inclusive_amount', term: 'BT-112', name: 'Invoice total amount with VAT', xpath: `/Invoice/${LMT}/cbc:TaxInclusiveAmount`, kind: 'amount', source: src, select: ubl(LMT, 'cbc:TaxInclusiveAmount') }),
    doc({ field: 'prepaid_amount', term: 'BT-113', name: 'Paid amount', xpath: `/Invoice/${LMT}/cbc:PrepaidAmount`, kind: 'amount', source: src, select: ubl(LMT, 'cbc:PrepaidAmount') }),
    doc({ field: 'rounding_amount', term: 'BT-114', name: 'Rounding amount', xpath: `/Invoice/${LMT}/cbc:PayableRoundingAmount`, kind: 'amount', source: src, select: ubl(LMT, 'cbc:PayableRoundingAmount') }),
    doc({ field: 'payable_amount', term: 'BT-115', name: 'Amount due for payment', xpath: `/Invoice/${LMT}/cbc:PayableAmount`, kind: 'amount', source: src, select: ubl(LMT, 'cbc:PayableAmount') }),
    line({ field: 'id', term: 'BT-126', name: 'Invoice line identifier', xpath: `${lineX}/cbc:ID`, kind: 'identifier', source: src, select: ubl('cbc:ID') }),
    line({ field: 'quantity', term: 'BT-129', name: 'Invoiced quantity', xpath: `${lineX}/cbc:InvoicedQuantity`, kind: 'quantity', source: src, select: ubl('cbc:InvoicedQuantity') }),
    line({ field: 'net_amount', term: 'BT-131', name: 'Invoice line net amount', xpath: `${lineX}/cbc:LineExtensionAmount`, kind: 'amount', source: src, select: ubl('cbc:LineExtensionAmount') }),
    line({ field: 'price', term: 'BT-146', name: 'Item net price', xpath: `${lineX}/cac:Price/cbc:PriceAmount`, kind: 'amount', source: src, select: ubl('cac:Price', 'cbc:PriceAmount') }),
    line({ field: 'base_quantity', term: 'BT-149', name: 'Item price base quantity', xpath: `${lineX}/cac:Price/cbc:BaseQuantity`, kind: 'quantity', source: src, select: ubl('cac:Price', 'cbc:BaseQuantity') }),
    line({ field: 'item_name', term: 'BT-153', name: 'Item name', xpath: `${lineX}/cac:Item/cbc:Name`, kind: 'text', source: src, select: ubl('cac:Item', 'cbc:Name') }),
    line({ field: 'vat_category', term: 'BT-151', name: 'Invoiced item VAT category code', xpath: `${lineX}/cac:Item/cac:ClassifiedTaxCategory/cbc:ID`, kind: 'code', source: src, select: ubl('cac:Item', 'cac:ClassifiedTaxCategory', 'cbc:ID') }),
    line({ field: 'vat_rate', term: 'BT-152', name: 'Invoiced item VAT rate', xpath: `${lineX}/cac:Item/cac:ClassifiedTaxCategory/cbc:Percent`, kind: 'rate', source: src, select: ubl('cac:Item', 'cac:ClassifiedTaxCategory', 'cbc:Percent') }),
    vbd({ field: 'taxable_amount', term: 'BT-116', name: 'VAT category taxable amount', xpath: '/Invoice/cac:TaxTotal[cac:TaxSubtotal]/cac:TaxSubtotal/cbc:TaxableAmount', kind: 'amount', source: src, select: ubl('cbc:TaxableAmount') }),
    vbd({ field: 'tax_amount', term: 'BT-117', name: 'VAT category tax amount', xpath: '/Invoice/cac:TaxTotal[cac:TaxSubtotal]/cac:TaxSubtotal/cbc:TaxAmount', kind: 'amount', source: src, select: ubl('cbc:TaxAmount') }),
    vbd({ field: 'category', term: 'BT-118', name: 'VAT category code', xpath: '/Invoice/cac:TaxTotal[cac:TaxSubtotal]/cac:TaxSubtotal/cac:TaxCategory/cbc:ID', kind: 'code', source: src, select: ubl('cac:TaxCategory', 'cbc:ID') }),
    vbd({ field: 'rate', term: 'BT-119', name: 'VAT category rate', xpath: '/Invoice/cac:TaxTotal[cac:TaxSubtotal]/cac:TaxSubtotal/cac:TaxCategory/cbc:Percent', kind: 'rate', source: src, select: ubl('cac:TaxCategory', 'cbc:Percent') }),
  ]
}

const PEPPOL_LINE = '/Invoice/cac:InvoiceLine'

/** Peppol BIS Billing 3.0 (UBL Invoice). Source: PEPPOL-SYNTAX (element → BT), CEN-SCH / PEPPOL-RULES (selectors). */
export const PEPPOL_BIS3_MAP: EinvoiceMap = {
  id: 'twin-einvoice-peppol-bis3', version: '0.3.0', domain: 'e-invoice', profile: 'peppol-bis3',
  namespaces: { ...UBL_NS }, lineXpath: PEPPOL_LINE, vatBreakdownXpath: '/Invoice/cac:TaxTotal[cac:TaxSubtotal]/cac:TaxSubtotal',
  fields: [
    ...ublCore('PEPPOL-SYNTAX', PEPPOL_LINE),
    doc({ field: 'due_date', term: 'BT-9', name: 'Payment due date', xpath: '/Invoice/cbc:DueDate', kind: 'date', source: 'PEPPOL-SYNTAX', select: ubl('cbc:DueDate') }),
    doc({ field: 'tax_point_date', term: 'BT-7', name: 'Value added tax point date', xpath: '/Invoice/cbc:TaxPointDate', kind: 'date', source: 'PEPPOL-SYNTAX', select: ubl('cbc:TaxPointDate') }),
    doc({ field: 'buyer_reference', term: 'BT-10', name: 'Buyer reference', xpath: '/Invoice/cbc:BuyerReference', kind: 'identifier', source: 'PEPPOL-SYNTAX', select: ubl('cbc:BuyerReference') }),
    doc({ field: 'delivery_date', term: 'BT-72', name: 'Actual delivery date', xpath: '/Invoice/cac:Delivery/cbc:ActualDeliveryDate', kind: 'date', source: 'PEPPOL-SYNTAX', select: ubl('cac:Delivery', 'cbc:ActualDeliveryDate') }),
    doc({ field: 'seller_trading_name', term: 'BT-28', name: 'Seller trading name', xpath: '/Invoice/cac:AccountingSupplierParty/cac:Party/cac:PartyName/cbc:Name', kind: 'text', source: 'PEPPOL-SYNTAX', select: ubl(...SUPPLIER, 'cac:PartyName', 'cbc:Name'), counterpart: 'buyer_trading_name' }),
    doc({ field: 'buyer_trading_name', term: 'BT-45', name: 'Buyer trading name', xpath: '/Invoice/cac:AccountingCustomerParty/cac:Party/cac:PartyName/cbc:Name', kind: 'text', source: 'PEPPOL-SYNTAX', select: ubl(...CUSTOMER, 'cac:PartyName', 'cbc:Name'), counterpart: 'seller_trading_name' }),
    doc({ field: 'seller_tax_registration_id', term: 'BT-32', name: 'Seller tax registration identifier', xpath: "/Invoice/cac:AccountingSupplierParty/cac:Party/cac:PartyTaxScheme[cac:TaxScheme/cbc:ID!='VAT']/cbc:CompanyID", kind: 'identifier', source: 'PEPPOL-SYNTAX', select: ubl(...SUPPLIER, vatScheme(false), 'cbc:CompanyID') }),
    doc({ field: 'seller_legal_registration_id', term: 'BT-30', name: 'Seller legal registration identifier', xpath: '/Invoice/cac:AccountingSupplierParty/cac:Party/cac:PartyLegalEntity/cbc:CompanyID', kind: 'identifier', source: 'PEPPOL-SYNTAX', select: ubl(...SUPPLIER, 'cac:PartyLegalEntity', 'cbc:CompanyID'), counterpart: 'buyer_legal_registration_id' }),
    doc({ field: 'buyer_legal_registration_id', term: 'BT-47', name: 'Buyer legal registration identifier', xpath: '/Invoice/cac:AccountingCustomerParty/cac:Party/cac:PartyLegalEntity/cbc:CompanyID', kind: 'identifier', source: 'PEPPOL-SYNTAX', select: ubl(...CUSTOMER, 'cac:PartyLegalEntity', 'cbc:CompanyID'), counterpart: 'seller_legal_registration_id' }),
    doc({ field: 'seller_electronic_address', term: 'BT-34', name: 'Seller electronic address', xpath: '/Invoice/cac:AccountingSupplierParty/cac:Party/cbc:EndpointID', kind: 'identifier', source: 'PEPPOL-SYNTAX', select: ubl(...SUPPLIER, 'cbc:EndpointID'), counterpart: 'buyer_electronic_address' }),
    doc({ field: 'buyer_electronic_address', term: 'BT-49', name: 'Buyer electronic address', xpath: '/Invoice/cac:AccountingCustomerParty/cac:Party/cbc:EndpointID', kind: 'identifier', source: 'PEPPOL-SYNTAX', select: ubl(...CUSTOMER, 'cbc:EndpointID'), counterpart: 'seller_electronic_address' }),
  ],
}

/** ZATCA (KSA) UBL profile. Source: ZATCA-DD (element → BT / KSA term), ZATCA-XML (selectors, rules). */
export const ZATCA_MAP: EinvoiceMap = {
  id: 'twin-einvoice-zatca-ksa', version: '0.3.0', domain: 'e-invoice', profile: 'zatca-ksa',
  namespaces: { ...UBL_NS }, lineXpath: PEPPOL_LINE, vatBreakdownXpath: '/Invoice/cac:TaxTotal[cac:TaxSubtotal]/cac:TaxSubtotal',
  fields: [
    ...ublCore('ZATCA-DD', PEPPOL_LINE),
    doc({ field: 'uuid', term: 'KSA-1', name: 'Unique invoice identifier', xpath: '/Invoice/cbc:UUID', kind: 'identifier', source: 'ZATCA-DD', select: ubl('cbc:UUID') }),
    doc({ field: 'issue_time', term: 'KSA-25', name: 'Invoice issue time', xpath: '/Invoice/cbc:IssueTime', kind: 'time', source: 'ZATCA-DD', select: ubl('cbc:IssueTime') }),
    doc({ field: 'supply_date', term: 'KSA-5', name: 'Supply date (gregorian calendar)', xpath: '/Invoice/cac:Delivery/cbc:ActualDeliveryDate', kind: 'date', source: 'ZATCA-DD', select: ubl('cac:Delivery', 'cbc:ActualDeliveryDate') }),
    doc({ field: 'supply_end_date', term: 'KSA-24', name: 'Supply end date', xpath: '/Invoice/cac:Delivery/cbc:LatestDeliveryDate', kind: 'date', source: 'ZATCA-DD', select: ubl('cac:Delivery', 'cbc:LatestDeliveryDate') }),
    line({ field: 'vat_amount', term: 'KSA-11', name: 'VAT line amount', xpath: `${PEPPOL_LINE}/cac:TaxTotal/cbc:TaxAmount`, kind: 'amount', source: 'ZATCA-DD', select: ubl('cac:TaxTotal', 'cbc:TaxAmount') }),
    line({ field: 'amount_with_vat', term: 'KSA-12', name: 'Line amount inclusive VAT', xpath: `${PEPPOL_LINE}/cac:TaxTotal/cbc:RoundingAmount`, kind: 'amount', source: 'ZATCA-DD', select: ubl('cac:TaxTotal', 'cbc:RoundingAmount') }),
  ],
}

const FA = ['k:Fa']
const P1 = ['k:Podmiot1', 'k:DaneIdentyfikacyjne']
const P2 = ['k:Podmiot2', 'k:DaneIdentyfikacyjne']
const K_LINE = '/Faktura/Fa/FaWiersz'
/** FA(3) per-rate buckets as the XSD declares them (P_13_6 is split into _1/_2/_3; P_14_xW is VAT converted to PLN). */
export const KSEF_BUCKETS: readonly { code: string; name: string }[] = [
  { code: 'P_13_1', name: 'Suma wartości sprzedaży netto objętej stawką podstawową (23% albo 22%)' },
  { code: 'P_14_1', name: 'Kwota podatku od sumy wartości sprzedaży netto objętej stawką podstawową' },
  { code: 'P_14_1W', name: 'Kwota podatku (stawka podstawowa) przeliczona na PLN (faktura w walucie obcej)' },
  { code: 'P_13_2', name: 'Suma wartości sprzedaży netto objętej stawką obniżoną pierwszą (8% albo 7%)' },
  { code: 'P_14_2', name: 'Kwota podatku od sumy wartości sprzedaży netto objętej stawką obniżoną pierwszą' },
  { code: 'P_14_2W', name: 'Kwota podatku (stawka obniżona pierwsza) przeliczona na PLN' },
  { code: 'P_13_3', name: 'Suma wartości sprzedaży netto objętej stawką obniżoną drugą (5%)' },
  { code: 'P_14_3', name: 'Kwota podatku od sumy wartości sprzedaży netto objętej stawką obniżoną drugą' },
  { code: 'P_14_3W', name: 'Kwota podatku (stawka obniżona druga) przeliczona na PLN' },
  { code: 'P_13_4', name: 'Suma wartości sprzedaży netto objętej ryczałtem dla taksówek osobowych' },
  { code: 'P_14_4', name: 'Kwota podatku (ryczałt dla taksówek osobowych)' },
  { code: 'P_14_4W', name: 'Wysokość ryczałtu dla taksówek osobowych przeliczona na PLN' },
  { code: 'P_13_5', name: 'Suma wartości sprzedaży netto w procedurze szczególnej (dział XII rozdział 6a)' },
  { code: 'P_14_5', name: 'Kwota podatku od wartości dodanej w procedurze szczególnej (dział XII rozdział 6a)' },
  { code: 'P_13_6_1', name: 'Suma wartości sprzedaży objętej stawką 0% z wyłączeniem WDT i eksportu' },
  { code: 'P_13_6_2', name: 'Suma wartości sprzedaży objętej stawką 0% w przypadku WDT' },
  { code: 'P_13_6_3', name: 'Suma wartości sprzedaży objętej stawką 0% w przypadku eksportu' },
  { code: 'P_13_7', name: 'Suma wartości sprzedaży zwolnionej od podatku' },
  { code: 'P_13_8', name: 'Suma wartości sprzedaży poza terytorium kraju' },
  { code: 'P_13_9', name: 'Suma wartości świadczenia usług z art. 100 ust. 1 pkt 4' },
  { code: 'P_13_10', name: 'Suma wartości sprzedaży w procedurze odwrotnego obciążenia' },
  { code: 'P_13_11', name: 'Suma wartości sprzedaży w procedurze marży' },
]

/** KSeF FA(3) (Poland; NOT EN 16931). Source: KSEF-XSD (element documentation), KSEF-MF (field descriptions). */
export const KSEF_FA3_MAP: EinvoiceMap = {
  id: 'twin-einvoice-ksef-fa3', version: '0.3.0', domain: 'e-invoice', profile: 'ksef-fa3',
  namespaces: { k: KSEF_NS }, lineXpath: K_LINE, vatBreakdownXpath: null,
  fields: [
    doc({ field: 'invoice_number', term: 'P_2', name: 'Kolejny numer faktury', xpath: '/Faktura/Fa/P_2', kind: 'identifier', source: 'KSEF-XSD', select: ksef(...FA, 'k:P_2') }),
    doc({ field: 'issue_date', term: 'P_1', name: 'Data wystawienia', xpath: '/Faktura/Fa/P_1', kind: 'date', source: 'KSEF-XSD', select: ksef(...FA, 'k:P_1') }),
    doc({ field: 'currency', term: 'KodWaluty', name: 'Kod waluty (ISO 4217)', xpath: '/Faktura/Fa/KodWaluty', kind: 'code', source: 'KSEF-XSD', select: ksef(...FA, 'k:KodWaluty') }),
    doc({ field: 'supply_date', term: 'P_6', name: 'Data dokonania lub zakończenia dostawy towarów lub wykonania usługi lub data otrzymania zapłaty', xpath: '/Faktura/Fa/P_6', kind: 'date', source: 'KSEF-XSD', select: ksef(...FA, 'k:P_6') }),
    doc({ field: 'seller_nip', term: 'Podmiot1/NIP', name: 'Identyfikator podatkowy NIP (sprzedawca)', xpath: '/Faktura/Podmiot1/DaneIdentyfikacyjne/NIP', kind: 'identifier', source: 'KSEF-XSD', select: ksef(...P1, 'k:NIP'), counterpart: 'buyer_nip' }),
    doc({ field: 'seller_name', term: 'Podmiot1/Nazwa', name: 'Imię i nazwisko lub nazwa (sprzedawca)', xpath: '/Faktura/Podmiot1/DaneIdentyfikacyjne/Nazwa', kind: 'text', source: 'KSEF-XSD', select: ksef(...P1, 'k:Nazwa'), counterpart: 'buyer_name' }),
    doc({ field: 'buyer_nip', term: 'Podmiot2/NIP', name: 'Identyfikator podatkowy NIP (nabywca)', xpath: '/Faktura/Podmiot2/DaneIdentyfikacyjne/NIP', kind: 'identifier', source: 'KSEF-XSD', select: ksef(...P2, 'k:NIP'), counterpart: 'seller_nip' }),
    doc({ field: 'buyer_name', term: 'Podmiot2/Nazwa', name: 'Imię i nazwisko lub nazwa (nabywca)', xpath: '/Faktura/Podmiot2/DaneIdentyfikacyjne/Nazwa', kind: 'text', source: 'KSEF-XSD', select: ksef(...P2, 'k:Nazwa'), counterpart: 'seller_name' }),
    ...KSEF_BUCKETS.map((b) => doc({ field: b.code, term: b.code, name: b.name, xpath: `/Faktura/Fa/${b.code}`, kind: 'amount', source: 'KSEF-XSD', select: ksef(...FA, `k:${b.code}`) })),
    doc({ field: 'P_15', term: 'P_15', name: 'Kwota należności ogółem', xpath: '/Faktura/Fa/P_15', kind: 'amount', source: 'KSEF-XSD', select: ksef(...FA, 'k:P_15') }),
    line({ field: 'number', term: 'NrWierszaFa', name: 'Kolejny numer wiersza faktury', xpath: `${K_LINE}/NrWierszaFa`, kind: 'identifier', source: 'KSEF-XSD', select: ksef('k:NrWierszaFa') }),
    line({ field: 'item_name', term: 'P_7', name: 'Nazwa (rodzaj) towaru lub usługi', xpath: `${K_LINE}/P_7`, kind: 'text', source: 'KSEF-XSD', select: ksef('k:P_7') }),
    line({ field: 'P_7', term: 'P_7', name: 'Nazwa (rodzaj) towaru lub usługi', xpath: `${K_LINE}/P_7`, kind: 'text', source: 'KSEF-XSD', select: ksef('k:P_7') }),
    line({ field: 'quantity', term: 'P_8B', name: 'Ilość (liczba) dostarczonych towarów lub zakres wykonanych usług', xpath: `${K_LINE}/P_8B`, kind: 'quantity', source: 'KSEF-XSD', select: ksef('k:P_8B') }),
    line({ field: 'P_8B', term: 'P_8B', name: 'Ilość (liczba) dostarczonych towarów lub zakres wykonanych usług', xpath: `${K_LINE}/P_8B`, kind: 'quantity', source: 'KSEF-XSD', select: ksef('k:P_8B') }),
    line({ field: 'price', term: 'P_9A', name: 'Cena jednostkowa towaru lub usługi bez kwoty podatku (cena jednostkowa netto)', xpath: `${K_LINE}/P_9A`, kind: 'amount', source: 'KSEF-XSD', select: ksef('k:P_9A') }),
    line({ field: 'P_9A', term: 'P_9A', name: 'Cena jednostkowa netto', xpath: `${K_LINE}/P_9A`, kind: 'amount', source: 'KSEF-XSD', select: ksef('k:P_9A') }),
    line({ field: 'P_9B', term: 'P_9B', name: 'Cena wraz z kwotą podatku (cena jednostkowa brutto)', xpath: `${K_LINE}/P_9B`, kind: 'amount', source: 'KSEF-XSD', select: ksef('k:P_9B') }),
    line({ field: 'P_10', term: 'P_10', name: 'Kwoty wszelkich opustów lub obniżek cen', xpath: `${K_LINE}/P_10`, kind: 'amount', source: 'KSEF-XSD', select: ksef('k:P_10') }),
    line({ field: 'P_11', term: 'P_11', name: 'Wartość sprzedaży netto', xpath: `${K_LINE}/P_11`, kind: 'amount', source: 'KSEF-XSD', select: ksef('k:P_11') }),
    line({ field: 'P_11A', term: 'P_11A', name: 'Wartość sprzedaży brutto (art. 106e ust. 7 i 8)', xpath: `${K_LINE}/P_11A`, kind: 'amount', source: 'KSEF-XSD', select: ksef('k:P_11A') }),
    line({ field: 'P_11Vat', term: 'P_11Vat', name: 'Kwota podatku (art. 106e ust. 10)', xpath: `${K_LINE}/P_11Vat`, kind: 'amount', source: 'KSEF-XSD', select: ksef('k:P_11Vat') }),
    line({ field: 'P_12', term: 'P_12', name: 'Stawka podatku', xpath: `${K_LINE}/P_12`, kind: 'code', source: 'KSEF-XSD', select: ksef('k:P_12') }),
  ],
}

export const EINVOICE_MAPS: Record<EinvoiceProfile, EinvoiceMap> = {
  'peppol-bis3': PEPPOL_BIS3_MAP,
  'zatca-ksa': ZATCA_MAP,
  'ksef-fa3': KSEF_FA3_MAP,
}

/** The line elements and VAT-breakdown elements of a document, in document order. */
export function lineElements(map: EinvoiceMap, root: XmlElement): XmlElement[] {
  return map.profile === 'ksef-fa3' ? ksef(...FA, 'k:FaWiersz')(root) : ubl('cac:InvoiceLine')(root)
}
export function vatBreakdownElements(map: EinvoiceMap, root: XmlElement): XmlElement[] {
  if (map.vatBreakdownXpath === null) return []
  const tt = taxTotal(true)(root)
  return tt.length === 1 ? kids(tt[0]!, UBL_NS.cac, 'TaxSubtotal') : []
}
/** the number of tax totals with a breakdown (a VAT-breakdown claim abstains unless exactly one) */
export function breakdownTotals(root: XmlElement): number { return taxTotal(true)(root).length }

/** Walk a declared path from the root, for the consistency layer (same helpers as the map). */
export const selectUbl = ubl
export const selectKsef = ksef
