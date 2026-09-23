/**
 * INVOICE ontology — field-path → universal-role mappings for a generic commercial invoice,
 * plus optional contract (PO / rate agreement) and evidence (receipt / delivery / ticket) documents.
 *
 * Seeded 2026-09-22 from the engine's freight, finance, insurance-claims and government-contracting
 * invoice-document mappings (the paths that generalize), extended with the totals block the footing
 * axioms need. This file IS the long tail: every real-world field name we encounter that isn't here
 * becomes an alternativePath or alias, with a fixture proving it.
 *
 * Resolution order per mapping (see OntologicalBridge.extractWithFallbacks):
 *   fieldPath (confidence 100) → alternativePaths (95) → fuzzy alias search with type guard (75).
 * Only exact/alternative matches can LOCK a verdict; fuzzy binds evaluate but never lock.
 */

import type { DomainOntology, DomainFieldMapping, UniversalRole } from '../../kernel/types.js'

const D = 'invoice'

// ---------------------------------------------------------------------------------------------
// INVOICE DOCUMENT — per-line roles (bound per line item via createLineItemBindings)
// ---------------------------------------------------------------------------------------------
const LINE_ITEM_MAPPINGS: DomainFieldMapping[] = [
  {
    domain: D, role: 'RATE_APPLIED', documentType: 'invoice', priority: 100,
    fieldPath: 'line_items[*].unit_price',
    alternativePaths: [
      'line_items[*].rate', 'line_items[*].price', 'line_items[*].unit_rate',
      'line_items[*].unit_cost', 'line_items[*].hourly_rate', 'line_items[*].price_per_unit',
      'items[*].unit_price', 'items[*].rate', 'items[*].price', 'lines[*].unit_price', 'lines[*].rate',
    ],
    fieldAliases: ['unit_price', 'rate', 'price', 'unit_rate', 'unit_cost'],
  },
  {
    domain: D, role: 'CLAIMED_QUANTITY', documentType: 'invoice', priority: 100,
    fieldPath: 'line_items[*].quantity',
    alternativePaths: [
      'line_items[*].qty', 'line_items[*].units', 'line_items[*].hours', 'line_items[*].count',
      'items[*].quantity', 'items[*].qty', 'lines[*].quantity', 'lines[*].qty',
    ],
    fieldAliases: ['quantity', 'qty', 'units', 'hours'],
  },
  {
    domain: D, role: 'CLAIMED_AMOUNT', documentType: 'invoice', priority: 100,
    fieldPath: 'line_items[*].amount',
    alternativePaths: [
      'line_items[*].total', 'line_items[*].line_total', 'line_items[*].extended_amount',
      'line_items[*].extended_price', 'line_items[*].subtotal', 'line_items[*].net_amount',
      'items[*].amount', 'items[*].total', 'items[*].line_total', 'lines[*].amount', 'lines[*].total',
    ],
    fieldAliases: ['amount', 'total', 'line_total', 'extended_amount'],
  },
  {
    domain: D, role: 'INVOICE_DESCRIPTION', documentType: 'invoice', priority: 100,
    fieldPath: 'line_items[*].description',
    alternativePaths: [
      'line_items[*].item', 'line_items[*].service', 'line_items[*].name', 'line_items[*].product',
      'items[*].description', 'items[*].name', 'lines[*].description',
    ],
    fieldAliases: ['description', 'item', 'service', 'name', 'product'],
  },
]

// ---------------------------------------------------------------------------------------------
// INVOICE DOCUMENT — document-level roles (totals block, identifiers, dates, currency)
// ---------------------------------------------------------------------------------------------
const DOCUMENT_MAPPINGS: DomainFieldMapping[] = [
  {
    domain: D, role: 'SUBTOTAL', documentType: 'invoice', priority: 100, fuzzyMatch: false,
    fieldPath: 'totals.subtotal',
    alternativePaths: [
      'subtotal', 'sub_total', 'totals.sub_total', 'totals.net', 'totals.net_amount',
      'amounts.subtotal', 'summary.subtotal', 'net_amount', 'subtotal_amount',
    ],
    fieldAliases: ['subtotal', 'sub_total', 'net_amount'],
  },
  {
    domain: D, role: 'TAX_AMOUNT', documentType: 'invoice', priority: 100, fuzzyMatch: false,
    fieldPath: 'totals.tax',
    alternativePaths: [
      'tax', 'tax_amount', 'totals.tax_amount', 'totals.tax_total', 'tax_total',
      'sales_tax', 'totals.sales_tax', 'vat', 'vat_amount', 'totals.vat', 'totals.vat_amount',
      'taxes.total', 'amounts.tax', 'summary.tax',
    ],
    fieldAliases: ['tax', 'tax_amount', 'sales_tax', 'vat', 'vat_amount'],
  },
  {
    domain: D, role: 'TAX_RATE', documentType: 'invoice', priority: 100, fuzzyMatch: false,
    fieldPath: 'totals.tax_rate',
    alternativePaths: [
      'tax_rate', 'vat_rate', 'sales_tax_rate', 'tax_percent', 'tax_percentage',
      'tax.rate', 'taxes.rate', 'amounts.tax_rate', 'summary.tax_rate',
    ],
    fieldAliases: ['tax_rate', 'vat_rate', 'tax_percent'],
  },
  {
    domain: D, role: 'DISCOUNT_AMOUNT', documentType: 'invoice', priority: 100, fuzzyMatch: false,
    fieldPath: 'totals.discount',
    alternativePaths: [
      'discount', 'discount_amount', 'totals.discount_amount', 'discounts.total',
      'amounts.discount', 'summary.discount', 'total_discount', 'sub_total.discount_price',
    ],
    fieldAliases: ['discount', 'discount_amount'],
  },
  {
    // Real receipts add a service charge / gratuity between subtotal and total (CORD `service_price`).
    domain: D, role: 'SERVICE_CHARGE', documentType: 'invoice', priority: 100, fuzzyMatch: false,
    fieldPath: 'totals.service_charge',
    alternativePaths: [
      'service_charge', 'service', 'svc', 'gratuity', 'totals.service', 'totals.service_price',
      'amounts.service_charge', 'summary.service_charge', 'sub_total.service_price', 'service_price',
    ],
    fieldAliases: ['service_charge', 'service', 'gratuity'],
  },
  {
    domain: D, role: 'GRAND_TOTAL', documentType: 'invoice', priority: 100, fuzzyMatch: false,
    fieldPath: 'totals.total',
    alternativePaths: [
      'total', 'grand_total', 'totals.grand_total', 'total_amount', 'totals.total_amount',
      'amount_due', 'totals.amount_due', 'balance_due', 'totals.balance_due',
      'invoice_total', 'total_due', 'amounts.total', 'summary.total',
    ],
    fieldAliases: ['total', 'grand_total', 'total_amount', 'amount_due', 'balance_due', 'invoice_total'],
  },
  {
    domain: D, role: 'DOCUMENT_ID', documentType: 'invoice', priority: 100,
    fieldPath: 'invoice_number',
    alternativePaths: [
      'document_number', 'invoice_id', 'invoice_no', 'number', 'id', 'reference', 'reference_number',
      'header.invoice_number', 'metadata.invoice_number',
    ],
    fieldAliases: ['invoice_number', 'document_number', 'invoice_no', 'reference'],
  },
  {
    // The bridge special-cases EVENT_DATE via extractDateValue() (prefers service_date over invoice_date).
    domain: D, role: 'EVENT_DATE', documentType: 'invoice', priority: 90,
    fieldPath: 'dates[*].value',
    alternativePaths: ['dates[*].date', 'service_date', 'invoice_date', 'issue_date', 'date', 'header.invoice_date'],
  },
  {
    // Strings only; fuzzy search disabled so an unrelated string can never be mistaken for a currency.
    domain: D, role: 'CURRENCY_CODE', documentType: 'invoice', priority: 100, fuzzyMatch: false,
    fieldPath: 'currency',
    alternativePaths: ['currency_code', 'totals.currency', 'amounts.currency', 'header.currency', 'metadata.currency'],
  },
  {
    // Supplied by the caller (their AP system knows prior invoices); an array. Required by DUP_PROHIB.
    domain: D, role: 'PRIOR_CLAIM_IDS', documentType: 'invoice', priority: 100, fuzzyMatch: false,
    fieldPath: 'prior_invoice_ids',
    alternativePaths: ['prior_claim_ids', 'duplicate_candidates', 'related_invoice_ids', 'prior_invoices'],
  },
]

// ---------------------------------------------------------------------------------------------
// CONTRACT / PO / RATE AGREEMENT — optional reference; enables RATE_SUP, AMT_CAP, TIME_ORD
// ---------------------------------------------------------------------------------------------
const CONTRACT_MAPPINGS: DomainFieldMapping[] = [
  {
    domain: D, role: 'RATE_CONTRACTED', documentType: 'contract', priority: 100,
    fieldPath: 'rates[*].rate',
    alternativePaths: [
      'financial_rules[*].values.rate', 'financial_rules[*].rate', 'price_list[*].unit_price',
      'line_items[*].unit_price', 'line_items[*].rate', 'contracted_rate', 'unit_price', 'rate', 'hourly_rate',
    ],
    fieldAliases: ['rate', 'unit_price', 'contracted_rate', 'hourly_rate'],
  },
  {
    domain: D, role: 'CONTRACTED_LIMIT', documentType: 'contract', priority: 100,
    fieldPath: 'max_amount',
    alternativePaths: [
      'financial_rules[*].values.max_amount', 'financial_rules[*].values.cap', 'limits.max',
      'not_to_exceed', 'nte', 'cap', 'po_total', 'purchase_order.total', 'totals.total', 'total', 'amount',
    ],
    fieldAliases: ['max_amount', 'cap', 'limit', 'not_to_exceed', 'po_total'],
  },
  {
    domain: D, role: 'CONTRACT_START', documentType: 'contract', priority: 100,
    fieldPath: 'effective_date',
    alternativePaths: ['start_date', 'contract_start', 'key_terms.effective_date', 'period.start', 'valid_from', 'po_date'],
  },
  {
    domain: D, role: 'CONTRACT_END', documentType: 'contract', priority: 100,
    fieldPath: 'expiration_date',
    alternativePaths: ['end_date', 'contract_end', 'key_terms.expiration_date', 'termination_date', 'period.end', 'valid_to'],
  },
]

// ---------------------------------------------------------------------------------------------
// EVIDENCE — receipt / delivery note / field ticket; optional reference; enables QTY_MATCH
// ---------------------------------------------------------------------------------------------
const EVIDENCE_MAPPINGS: DomainFieldMapping[] = [
  {
    domain: D, role: 'ACTUAL_QUANTITY', documentType: 'evidence', priority: 100,
    fieldPath: 'line_items[*].quantity',
    alternativePaths: [
      'line_items[*].qty', 'line_items[*].units', 'line_items[*].hours', 'quantity', 'qty',
      'received_quantity', 'delivered_quantity', 'totals.quantity', 'totals.total_quantity', 'totals.hours',
    ],
    fieldAliases: ['quantity', 'qty', 'units', 'hours', 'received_quantity', 'delivered_quantity'],
  },
  {
    domain: D, role: 'VERIFIED_AMOUNT', documentType: 'evidence', priority: 100,
    fieldPath: 'totals.total',
    alternativePaths: ['amount', 'total', 'verified_amount', 'receipt_total', 'totals.amount'],
  },
  {
    domain: D, role: 'EVENT_DATE', documentType: 'evidence', priority: 100,
    fieldPath: 'dates[*].date',
    alternativePaths: ['dates[*].value', 'date', 'service_date', 'delivery_date', 'received_date', 'ticket_date'],
  },
  {
    domain: D, role: 'EVIDENCE_DESCRIPTION', documentType: 'evidence', priority: 100,
    fieldPath: 'line_items[*].description',
    alternativePaths: ['description', 'item', 'service', 'line_items[*].item', 'line_items[*].service'],
    fieldAliases: ['description', 'item', 'service'],
  },
]

// ---------------------------------------------------------------------------------------------
// MULTILINGUAL field-name aliases. Deterministic verification is LANGUAGE-AGNOSTIC on the numbers — footing, tax, and
// duplicate checks don't care what language a document is in (proven on Indonesian CORD receipts). Only the field NAMES
// differ. Adding aliases here makes a Spanish / French / German / Italian / Portuguese / Dutch invoice verify with NO
// model involved — the exact wall the English-only, US-cloud incumbents can't cross. CJK / RTL languages are next.
// ---------------------------------------------------------------------------------------------
const I18N: Partial<Record<UniversalRole, string[]>> = {
  // European (Romance / Germanic / Dutch)
  SUBTOTAL: ['subtotal', 'base_imponible', 'sous_total', 'soustotal', 'zwischensumme', 'subtotale', 'subtotaal',
    // CJK / Cyrillic / Arabic
    '小计', '小計', '소계', 'подытог', 'сумма_без_налога'],
  TAX_AMOUNT: ['impuesto', 'iva', 'tva', 'mwst', 'steuer', 'umsatzsteuer', 'imposta', 'imposto', 'btw',
    '税', '税额', '税額', '消費税', '세금', 'налог', 'ндс', 'الضريبة'],
  TAX_RATE: ['tipo_iva', 'tasa_iva', 'taux_tva', 'steuersatz', 'aliquota_iva', 'taxa_iva',
    '税率', '세율', 'ставка_налога'],
  DISCOUNT_AMOUNT: ['descuento', 'remise', 'rabais', 'rabatt', 'nachlass', 'sconto', 'desconto', 'korting',
    '折扣', '割引', '할인', 'скидка', 'الخصم'],
  SERVICE_CHARGE: ['servicio', 'cargo_por_servicio', 'servizio', 'bedienung', 'taxe_de_service', '服务费', 'サービス料'],
  GRAND_TOTAL: ['total', 'total_factura', 'importe_total', 'montant_total', 'gesamtbetrag', 'gesamt', 'endbetrag', 'totale', 'totaal', 'valor_total',
    '合计', '总计', '合計', '합계', '총계', 'итого', 'всего', 'المجموع', 'الإجمالي'],
  CURRENCY_CODE: ['moneda', 'devise', 'waehrung', 'valuta', 'moeda', '货币', '通貨', 'валюта', 'العملة'],
  RATE_APPLIED: ['precio_unitario', 'precio', 'prix_unitaire', 'prix', 'einzelpreis', 'preis', 'prezzo_unitario', 'prezzo', 'preco',
    '单价', '単価', '단가', 'цена', 'سعر_الوحدة'],
  CLAIMED_QUANTITY: ['cantidad', 'quantite', 'menge', 'anzahl', 'quantita', 'quantidade',
    '数量', '수량', 'количество', 'الكمية'],
  CLAIMED_AMOUNT: ['importe', 'montant', 'betrag', 'importo', 'valor', 'gesamtpreis',
    '金额', '金額', '금액', 'сумма', 'المبلغ'],
  INVOICE_DESCRIPTION: ['descripcion', 'concepto', 'designation', 'beschreibung', 'bezeichnung', 'descrizione', 'descricao', 'articulo', 'artikel',
    '描述', '摘要', '品名', '내역', 'описание', 'الوصف'],
}
// Additional high-trade languages, ASCII field names only (Indonesian / Malay / Turkish / Swedish) — safe to hard-code.
// Diacritic-heavy or non-Latin field names (Vietnamese, Polish, Hindi, Thai, full Arabic phrases) are best supplied by the
// caller via the declarative ruleset's field-alias override — the numbers already fold universally; only NAMES need locale
// review. Native review recommended before advertising any specific language by name.
const TRADE_I18N: Partial<Record<UniversalRole, string[]>> = {
  SUBTOTAL: ['ara_toplam', 'delsumma', 'jumlah', 'subtotal_harga'],
  TAX_AMOUNT: ['kdv', 'vergi', 'moms', 'skatt', 'pajak', 'ppn'],
  TAX_RATE: ['kdv_orani', 'momssats', 'tarif_pajak'],
  DISCOUNT_AMOUNT: ['indirim', 'rabatt', 'diskon', 'potongan'],
  GRAND_TOTAL: ['genel_toplam', 'toplam', 'totalt', 'summa', 'total_harga', 'jumlah_total'],
  CURRENCY_CODE: ['para_birimi', 'valuta_kod', 'mata_uang'],
  RATE_APPLIED: ['birim_fiyat', 'styckpris', 'harga_satuan', 'harga'],
  CLAIMED_QUANTITY: ['miktar', 'adet', 'antal', 'kuantitas', 'jumlah_barang'],
  CLAIMED_AMOUNT: ['tutar', 'belopp', 'nilai', 'jumlah_harga'],
  INVOICE_DESCRIPTION: ['aciklama', 'beskrivning', 'keterangan', 'deskripsi'],
}
{
  const lineRoles = new Set(LINE_ITEM_MAPPINGS)
  for (const m of [...LINE_ITEM_MAPPINGS, ...DOCUMENT_MAPPINGS]) {
    const extra = [...(I18N[m.role] ?? []), ...(TRADE_I18N[m.role] ?? [])]
    if (extra.length === 0) continue
    const alt = (m.alternativePaths ??= [])
    for (const a of extra) {
      const forms = lineRoles.has(m)
        ? [`line_items[*].${a}`, `items[*].${a}`, `lines[*].${a}`]
        : [a, `totals.${a}`]
      for (const f of forms) if (!alt.includes(f)) alt.push(f)
    }
  }
}

export const INVOICE_ONTOLOGY: DomainOntology = {
  domainId: D,
  domainName: 'Commercial Invoice (generic)',
  mappings: [
    ...LINE_ITEM_MAPPINGS,
    ...DOCUMENT_MAPPINGS,
    ...CONTRACT_MAPPINGS,
    ...EVIDENCE_MAPPINGS,
  ],
}

export default INVOICE_ONTOLOGY
