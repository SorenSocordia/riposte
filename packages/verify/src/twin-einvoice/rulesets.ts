/**
 * The built-in e-invoice footing rulesets, embedded so the twin needs no file I/O at runtime.
 *
 * These are VERBATIM copies of products/verify/docs/examples/{peppol-en16931,zatca-ksa,ksef-fa3}.ruleset.json
 * (test/twin-einvoice.test.ts deep-compares them to the files, so a drift fails the suite). Since 2026-09-28
 * (E-INVOICE-2) the twin applies NO override on top: the 0.1.0 Peppol ruleset carries R120's own slack itself.
 *
 * The spec rule each house check code implements (verified 2026-09-28):
 *   LINES_SUM_INT  BR-CO-10  BT-106 = Σ BT-131                        (Peppol rules page; CEN-EN16931-UBL.sch; ZATCA XML std p.38)
 *   TAX_EXCL_INT   BR-CO-13  BT-109 = Σ BT-131 − BT-107 + BT-108      (house uses BT-106 for Σ BT-131; BR-CO-10 ties them)
 *   TAX_INCL_INT   BR-CO-15  BT-112 = BT-109 + BT-110
 *   PAYABLE_INT    BR-CO-16  BT-115 = BT-112 − BT-113 + BT-114
 *   LINE_MATH_INT  PEPPOL-EN16931-R120 (Peppol) / BR-KSA-EN16931-11 (ZATCA): BT-131 = BT-129 × (BT-146 / BT-149)
 *                  + Σ BT-141 − Σ BT-136. The built-in formula carries the line's allowance and charge totals as optional
 *                  terms; the twin computes them from the line's own cac:AllowanceCharge amounts (consistency.ts).
 *   KSeF GROSS_INT: since 0.1.0 a DECLARED ABSTENTION (no primary source states P_15 = Σ P_13_x + Σ P_14_x).
 *   KSeF LINE_NET_INT: P_11 = P_8B × P_9A, per the MF brochure's worked examples (pp.100-104), abstaining when
 *                  P_10, P_9B or P_11A is reported. Neither is a KSeF validation rule: ⚠ house recon.
 *   KSeF DOZAPLATY_INT (0.2.0, E-INVOICE-2): DoZaplaty = P_15 + SumaObciazen − SumaOdliczen, stated by the FA(3) XSD
 *                  (Rozliczenie/DoZaplaty) and the MF sheet (p.105): reported as FA3-XSD:DoZaplaty, provenance SPEC.
 * Ruleset 0.1.0 (2026-09-28, docs/RULESET-CORRECTIONS-2026-09-28.md): UBL totals exact to the cent (tol 0.005,
 * rel 0), BT-110 required, KSeF field names per the FA(3) XSD. KSeF 0.2.0 (same day) adds DoZaplaty and runs strict
 * (rel 0; LINE_NET_INT 0.020001).
 */
import type { DeclarativeRuleset } from '../declarative/types.js'
import type { EinvoiceProfile } from './map.js'

export const HOUSE_PEPPOL_RULESET: DeclarativeRuleset = {
  id: 'peppol-en16931',
  version: '0.1.0',
  domain: 'e-invoice',
  name: 'Peppol BIS Billing 3.0 / EN 16931 invoice',
  sources: {
    'PEPPOL-RULES-CEN': 'https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-tc434/',
    'PEPPOL-RULES-PEPPOL': 'https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-peppol/',
    'CEN-SCH': 'https://github.com/OpenPEPPOL/peppol-bis-invoice-3/blob/master/rules/sch/CEN-EN16931-UBL.sch',
    'PEPPOL-SCH': 'https://github.com/OpenPEPPOL/peppol-bis-invoice-3/blob/master/rules/sch/PEPPOL-EN16931-UBL.sch',
    'PEPPOL-BIS': 'https://docs.peppol.eu/poacc/billing/3.0/bis/',
  },
  lineArrayKeys: ['lines', 'invoice_lines', 'line_items'],
  tolerance: { rel: 0, absCap: 0 },
  fields: {
    LINE_EXT: { paths: ['line_extension_amount', 'LineExtensionAmount', 'net_amount'], line: true },
    QTY: { paths: ['invoiced_quantity', 'InvoicedQuantity', 'quantity', 'qty'], kind: 'quantity', line: true },
    PRICE: { paths: ['price_amount', 'PriceAmount', 'price', 'unit_price'], kind: 'price', line: true },
    BASE_QTY: { paths: ['base_quantity', 'BaseQuantity'], kind: 'quantity', line: true, default: 1 },
    LINE_ALLOWANCE: { paths: ['line_allowance_amount', 'allowance_amount', 'allowance_total_amount'], line: true },
    LINE_CHARGE: { paths: ['line_charge_amount', 'charge_amount', 'charge_total_amount'], line: true },
    LINE_ALLOWANCE_CHARGE_LIST: { paths: ['allowance_charges', 'allowances_charges', 'AllowanceCharge', 'allowances', 'charges'], kind: 'string', line: true },
    SUM_LINE_NET: { paths: ['line_extension_amount', 'LineExtensionAmount', 'totals.line_extension_amount', 'sum_of_line_net_amount'] },
    ALLOWANCE: { paths: ['allowance_total_amount', 'AllowanceTotalAmount', 'totals.allowance_total_amount'], default: 0 },
    CHARGE: { paths: ['charge_total_amount', 'ChargeTotalAmount', 'totals.charge_total_amount'], default: 0 },
    TAX_EXCL: { paths: ['tax_exclusive_amount', 'TaxExclusiveAmount', 'totals.tax_exclusive_amount'] },
    TAX_AMT: { paths: ['tax_amount', 'TaxAmount', 'totals.tax_amount'] },
    TAX_INCL: { paths: ['tax_inclusive_amount', 'TaxInclusiveAmount', 'totals.tax_inclusive_amount'] },
    PREPAID: { paths: ['prepaid_amount', 'PrepaidAmount', 'totals.prepaid_amount'], default: 0 },
    ROUNDING: { paths: ['payable_rounding_amount', 'PayableRoundingAmount', 'totals.payable_rounding_amount'], default: 0 },
    PAYABLE: { paths: ['payable_amount', 'PayableAmount', 'totals.payable_amount', 'amount_due'] },
  },
  checks: [
    {
      code: 'LINES_SUM_INT',
      field: 'sum_of_line_net_amount',
      tol: 0.005,
      name: 'BR-CO-10: BT-106 = Σ BT-131, exact to the cent [PEPPOL-RULES-CEN, CEN-SCH]',
      left: 'SUM_LINE_NET',
      op: '=',
      right: 'sum(LINE_EXT)',
    },
    {
      code: 'TAX_EXCL_INT',
      field: 'tax_exclusive_amount',
      tol: 0.005,
      name: 'BR-CO-13: BT-109 = BT-106 − BT-107 + BT-108, exact to the cent [PEPPOL-RULES-CEN, CEN-SCH]',
      left: 'TAX_EXCL',
      op: '=',
      right: 'SUM_LINE_NET - ALLOWANCE + CHARGE',
    },
    {
      code: 'TAX_INCL_INT',
      field: 'tax_inclusive_amount',
      tol: 0.005,
      name: 'BR-CO-15: BT-112 = BT-109 + BT-110, exact to the cent; BT-110 is required [PEPPOL-RULES-CEN, CEN-SCH]',
      left: 'TAX_INCL',
      op: '=',
      right: 'TAX_EXCL + TAX_AMT',
    },
    {
      code: 'PAYABLE_INT',
      field: 'payable_amount',
      tol: 0.005,
      name: 'BR-CO-16: BT-115 = BT-112 − BT-113 + BT-114, exact to the cent [PEPPOL-RULES-CEN, CEN-SCH]',
      left: 'PAYABLE',
      op: '=',
      right: 'TAX_INCL - PREPAID + ROUNDING',
    },
    {
      code: 'LINE_MATH_INT',
      field: 'line_extension_amount',
      scope: 'line',
      tol: 0.020001,
      name: 'PEPPOL-EN16931-R120: BT-131 = BT-129 × (BT-146 / BT-149) + Σ BT-141 − Σ BT-136, slack 0.02 [PEPPOL-RULES-PEPPOL, PEPPOL-SCH]',
      left: 'LINE_EXT',
      op: '=',
      right: 'QTY * PRICE / BASE_QTY + LINE_CHARGE? - LINE_ALLOWANCE?',
      abstain_if_present: ['LINE_ALLOWANCE_CHARGE_LIST'],
      guard_reason: 'the line lists its allowances/charges as items; this ruleset reads only their totals (line_allowance_amount / line_charge_amount), so it cannot sum Σ BT-136 / Σ BT-141 here',
    },
  ],
}

export const HOUSE_ZATCA_RULESET: DeclarativeRuleset = {
  id: 'zatca-ksa-en16931',
  version: '0.1.0',
  domain: 'e-invoice',
  name: 'ZATCA (Saudi Arabia / FATOORA) e-invoice — EN 16931 document footing',
  sources: {
    'ZATCA-XML-STD': 'https://zatca.gov.sa/ar/E-Invoicing/SystemsDevelopers/Documents/20230519_ZATCA_Electronic_Invoice_XML_Implementation_Standard_%20vF.pdf',
    'ZATCA-DD': 'https://zatca.gov.sa/ar/E-Invoicing/SystemsDevelopers/Documents/20230519_EInvoice_Data_Dictionary%20vF.xlsx',
  },
  lineArrayKeys: ['lines', 'invoice_lines', 'line_items'],
  tolerance: { rel: 0, absCap: 0 },
  fields: {
    LINE_EXT: { paths: ['line_extension_amount', 'LineExtensionAmount', 'net_amount'], line: true },
    QTY: { paths: ['invoiced_quantity', 'InvoicedQuantity', 'quantity', 'qty'], kind: 'quantity', line: true },
    PRICE: { paths: ['price_amount', 'PriceAmount', 'price', 'unit_price'], kind: 'price', line: true },
    BASE_QTY: { paths: ['base_quantity', 'BaseQuantity'], kind: 'quantity', line: true, default: 1 },
    LINE_ALLOWANCE: { paths: ['line_allowance_amount', 'allowance_amount', 'allowance_total_amount'], line: true },
    LINE_CHARGE: { paths: ['line_charge_amount', 'charge_amount', 'charge_total_amount'], line: true },
    LINE_ALLOWANCE_CHARGE_LIST: { paths: ['allowance_charges', 'allowances_charges', 'AllowanceCharge', 'allowances', 'charges'], kind: 'string', line: true },
    SUM_LINE_NET: { paths: ['line_extension_amount', 'LineExtensionAmount', 'totals.line_extension_amount', 'sum_of_line_net_amount'] },
    ALLOWANCE: { paths: ['allowance_total_amount', 'AllowanceTotalAmount', 'totals.allowance_total_amount'], default: 0 },
    CHARGE: { paths: ['charge_total_amount', 'ChargeTotalAmount', 'totals.charge_total_amount'], default: 0 },
    TAX_EXCL: { paths: ['tax_exclusive_amount', 'TaxExclusiveAmount', 'totals.tax_exclusive_amount'] },
    TAX_AMT: { paths: ['tax_amount', 'TaxAmount', 'totals.tax_amount'] },
    TAX_INCL: { paths: ['tax_inclusive_amount', 'TaxInclusiveAmount', 'totals.tax_inclusive_amount'] },
    PREPAID: { paths: ['prepaid_amount', 'PrepaidAmount', 'totals.prepaid_amount'], default: 0 },
    ROUNDING: { paths: ['payable_rounding_amount', 'PayableRoundingAmount', 'totals.payable_rounding_amount'], default: 0 },
    PAYABLE: { paths: ['payable_amount', 'PayableAmount', 'totals.payable_amount', 'amount_due'] },
  },
  checks: [
    {
      code: 'LINES_SUM_INT',
      field: 'sum_of_line_net_amount',
      tol: 0.005,
      name: 'BR-CO-10: BT-106 = Σ BT-131, exact to the cent (totals rounded to two decimals, §10) [ZATCA-XML-STD pp.29, 38]',
      left: 'SUM_LINE_NET',
      op: '=',
      right: 'sum(LINE_EXT)',
    },
    {
      code: 'TAX_EXCL_INT',
      field: 'tax_exclusive_amount',
      tol: 0.005,
      name: 'BR-CO-13: BT-109 = Σ BT-131 − BT-107 + BT-108, exact to the cent [ZATCA-XML-STD pp.29, 38]',
      left: 'TAX_EXCL',
      op: '=',
      right: 'SUM_LINE_NET - ALLOWANCE + CHARGE',
    },
    {
      code: 'TAX_INCL_INT',
      field: 'tax_inclusive_amount',
      tol: 0.005,
      name: 'BR-CO-15: BT-112 = BT-109 + BT-110, exact to the cent; BT-110 is required (BR-KSA-EN16931-08) [ZATCA-XML-STD pp.29, 38, 67]',
      left: 'TAX_INCL',
      op: '=',
      right: 'TAX_EXCL + TAX_AMT',
    },
    {
      code: 'PAYABLE_INT',
      field: 'payable_amount',
      tol: 0.005,
      name: 'BR-CO-16: BT-115 = BT-112 − BT-113 + BT-114, exact to the cent [ZATCA-XML-STD pp.29, 38]',
      left: 'PAYABLE',
      op: '=',
      right: 'TAX_INCL - PREPAID + ROUNDING',
    },
    {
      code: 'LINE_MATH_INT',
      field: 'line_extension_amount',
      scope: 'line',
      tol: 0.005001,
      name: 'BR-KSA-EN16931-11: BT-131 = BT-129 × (BT-146 / BT-149) + Σ BT-141 − Σ BT-136; only the product is rounded, half-up to two decimals, so at most 0.005 apart (§9.3, §10) [ZATCA-XML-STD pp.17-18, 29, 67]',
      left: 'LINE_EXT',
      op: '=',
      right: 'QTY * PRICE / BASE_QTY + LINE_CHARGE? - LINE_ALLOWANCE?',
      abstain_if_present: ['LINE_ALLOWANCE_CHARGE_LIST'],
      guard_reason: 'the line lists its allowances/charges as items; this ruleset reads only their totals (line_allowance_amount / line_charge_amount), so it cannot sum Σ BT-136 / Σ BT-141 here',
    },
  ],
}

export const HOUSE_KSEF_RULESET: DeclarativeRuleset = {
  id: 'ksef-fa3-pl',
  version: '0.2.0',
  domain: 'e-invoice',
  name: 'Poland KSeF FA(3) invoice — national schema footing (NOT EN 16931)',
  sources: {
    'FA3-XSD': 'http://crd.gov.pl/wzor/2025/06/25/13775/schemat.xsd',
    'MF-BROSZURA': 'https://ksef.podatki.gov.pl/media/jknpcymf/broszura-informacyjna-dotyczaca-struktury-logicznej-fa-3-04032026.pdf',
    'FA3-XSD-DoZaplaty': 'http://crd.gov.pl/wzor/2025/06/25/13775/schemat.xsd, element Faktura/Fa/Rozliczenie/DoZaplaty, xsd:documentation (raw text): \'Kwota należności do zapłaty równa polu P_15 powiększonemu o Obciazenia i pomniejszonemu o Odliczenia\'',
  },
  lineArrayKeys: ['lines', 'FaWiersze', 'invoice_lines', 'line_items'],
  tolerance: { rel: 0, absCap: 0 },
  fields: {
    P_11: { paths: ['P_11', 'line_net', 'net_value'], line: true },
    P_8B: { paths: ['P_8B', 'quantity', 'qty'], kind: 'quantity', line: true },
    P_9A: { paths: ['P_9A', 'unit_price', 'net_unit_price'], kind: 'price', line: true },
    P_10: { paths: ['P_10', 'discount'], line: true },
    P_9B: { paths: ['P_9B'], line: true },
    P_11A: { paths: ['P_11A'], line: true },
    P_13_1: { paths: ['P_13_1'], default: 0 },
    P_13_2: { paths: ['P_13_2'], default: 0 },
    P_13_3: { paths: ['P_13_3'], default: 0 },
    P_13_4: { paths: ['P_13_4'], default: 0 },
    P_13_5: { paths: ['P_13_5'], default: 0 },
    P_13_6_1: { paths: ['P_13_6_1'], default: 0 },
    P_13_6_2: { paths: ['P_13_6_2'], default: 0 },
    P_13_6_3: { paths: ['P_13_6_3'], default: 0 },
    P_13_7: { paths: ['P_13_7'], default: 0 },
    P_13_8: { paths: ['P_13_8'], default: 0 },
    P_13_9: { paths: ['P_13_9'], default: 0 },
    P_13_10: { paths: ['P_13_10'], default: 0 },
    P_13_11: { paths: ['P_13_11'], default: 0 },
    P_14_1: { paths: ['P_14_1'], default: 0 },
    P_14_2: { paths: ['P_14_2'], default: 0 },
    P_14_3: { paths: ['P_14_3'], default: 0 },
    P_14_4: { paths: ['P_14_4'], default: 0 },
    P_14_5: { paths: ['P_14_5'], default: 0 },
    P_15: { paths: ['P_15', 'gross_total', 'amount_due'] },
    DO_ZAPLATY: { paths: ['DoZaplaty', 'Rozliczenie.DoZaplaty'] },
    SUMA_OBCIAZEN: { paths: ['SumaObciazen', 'Rozliczenie.SumaObciazen'] },
    SUMA_ODLICZEN: { paths: ['SumaOdliczen', 'Rozliczenie.SumaOdliczen'] },
    OBCIAZENIA: { paths: ['Obciazenia', 'Rozliczenie.Obciazenia'], kind: 'string' },
    ODLICZENIA: { paths: ['Odliczenia', 'Rozliczenie.Odliczenia'], kind: 'string' },
  },
  checks: [
    {
      code: 'GROSS_INT',
      field: 'P_15',
      tol: 0.02,
      name: 'P_15 = Σ P_13_x + Σ P_14_x over the FA(3) buckets (house candidate; not stated by the sources) [FA3-XSD, MF-BROSZURA]',
      left: 'P_15',
      op: '=',
      right: 'P_13_1 + P_13_2 + P_13_3 + P_13_4 + P_13_5 + P_13_6_1 + P_13_6_2 + P_13_6_3 + P_13_7 + P_13_8 + P_13_9 + P_13_10 + P_13_11 + P_14_1 + P_14_2 + P_14_3 + P_14_4 + P_14_5',
      abstain: 'UNSOURCED. Neither the FA(3) XSD nor the MF information sheet (2026-03-04) states P_15 = Σ P_13_x + Σ P_14_x. P_15 is \'Kwota należności ogółem\' (total amount due), and the sheet (p.52) names cases where it is something else: the payment documented (advance invoices), the amount remaining (art. 106f ust. 3 invoices) and the correction (corrective invoices). The formula over the full FA(3) bucket set is kept as the candidate until a source states it',
    },
    {
      code: 'LINE_NET_INT',
      field: 'P_11',
      scope: 'line',
      tol: 0.020001,
      name: 'P_11 = P_8B × P_9A, as the MF sheet\'s worked examples compute it (Przykład 22-23, pp.100-104: \'cena jednostkowa 90 zł, wartość netto 3 sztuk równa się 270 zł\'); a worked example, not a stated rule [MF-BROSZURA, FA3-XSD]',
      left: 'P_11',
      op: '=',
      right: 'P_8B * P_9A',
      abstain_if_present: ['P_10', 'P_9B', 'P_11A'],
      guard_reason: 'P_10 (discounts not already in the net unit price) is not stated as per unit or per line in the FA(3) XSD or the MF sheet (pp.90-91); P_9B / P_11A mark the gross method of art. 106e ust. 7-8, where the sheet says the gross unit price and gross value replace the net ones (p.90)',
    },
    {
      code: 'DOZAPLATY_INT',
      field: 'DoZaplaty',
      tol: 0.005,
      name: 'DoZaplaty = P_15 + SumaObciazen − SumaOdliczen, exact to the cent; stated by the XSD (\'Kwota należności do zapłaty równa polu P_15 powiększonemu o Obciazenia i pomniejszonemu o Odliczenia\') and the MF sheet (p.105) [FA3-XSD-DoZaplaty, MF-BROSZURA]',
      left: 'DO_ZAPLATY',
      op: '=',
      right: 'P_15 + SUMA_OBCIAZEN? - SUMA_ODLICZEN?',
      abstain_if_present_without: [{ present: 'OBCIAZENIA', without: 'SUMA_OBCIAZEN' }, { present: 'ODLICZENIA', without: 'SUMA_ODLICZEN' }],
      guard_reason: 'the MF sheet (p.105) defines SumaObciazen / SumaOdliczen as the sum of the items\' Kwota; this ruleset reads the stated sum and does not add up the items itself',
    },
  ],
}

/**
 * PEPPOL-EN16931-R120 compares with u:slack(…, 0.02), inclusive (rules/sch/PEPPOL-EN16931-UBL.sch). Until 2026-09-28
 * the twin overrode the built-in LINE_MATH_INT to exactly 0.02. In binary floating point that FAILed lines the spec
 * accepts: |0.07 − 0.05| is 0.020000000000000004 (E-INVOICE-2, engineering note "The e-invoice twin on official samples", 2026-09-28). The
 * 0.1.0 ruleset already carries R120's slack plus a 1e-6 float margin (0.020001, docs/RULESET-CORRECTIONS-2026-09-28.md), so the twin
 * now runs the shipped ruleset unchanged. Both names are kept for existing importers.
 */
export const PEPPOL_LINE_SLACK = HOUSE_PEPPOL_RULESET.checks.find((c) => c.code === 'LINE_MATH_INT')!.tol!
export const PEPPOL_TWIN_FOOTING: DeclarativeRuleset = HOUSE_PEPPOL_RULESET

/** The built-in footing ruleset the twin runs for a profile (its id@version is bound into every twin verdict's input). */
export function footingRulesetFor(profile: EinvoiceProfile): DeclarativeRuleset {
  return profile === 'peppol-bis3' ? HOUSE_PEPPOL_RULESET : profile === 'zatca-ksa' ? HOUSE_ZATCA_RULESET : HOUSE_KSEF_RULESET
}
