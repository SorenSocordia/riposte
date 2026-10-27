# The invoice@0.1.0 ruleset as data: field paths, laws, remedy table, words. prototype; no measured accuracy.
# SPDX-License-Identifier: Apache-2.0
"""
Everything the invoice ruleset declares, transcribed from the engine's sources (the file each block comes from is named
above it). Nothing here is computed; engine.py reads it. The remedy table is hashed into every verdict's identity
(remedy_table_hash), so a transcription error shows as a different verdict_id, never as a quiet difference.
"""

RULESET = {"id": "invoice", "version": "0.1.0", "domain": "invoice"}
ENGINE_VERSION = "0.7.2"
SCHEMA_VERSION = "v0"

# ---------------------------------------------------------------------------------------------------------------------
# packages/verify/src/rulesets/invoice/ontology.ts

_LINE = [
    ("RATE_APPLIED", 100, None, "line_items[*].unit_price", [
        "line_items[*].rate", "line_items[*].price", "line_items[*].unit_rate",
        "line_items[*].unit_cost", "line_items[*].hourly_rate", "line_items[*].price_per_unit",
        "items[*].unit_price", "items[*].rate", "items[*].price", "lines[*].unit_price", "lines[*].rate"]),
    ("CLAIMED_QUANTITY", 100, None, "line_items[*].quantity", [
        "line_items[*].qty", "line_items[*].units", "line_items[*].hours", "line_items[*].count",
        "items[*].quantity", "items[*].qty", "lines[*].quantity", "lines[*].qty"]),
    ("CLAIMED_AMOUNT", 100, None, "line_items[*].amount", [
        "line_items[*].total", "line_items[*].line_total", "line_items[*].extended_amount",
        "line_items[*].extended_price", "line_items[*].subtotal", "line_items[*].net_amount",
        "items[*].amount", "items[*].total", "items[*].line_total", "lines[*].amount", "lines[*].total"]),
    ("INVOICE_DESCRIPTION", 100, None, "line_items[*].description", [
        "line_items[*].item", "line_items[*].service", "line_items[*].name", "line_items[*].product",
        "items[*].description", "items[*].name", "lines[*].description"]),
]

_DOCUMENT = [
    ("SUBTOTAL", 100, False, "totals.subtotal", [
        "subtotal", "sub_total", "totals.sub_total", "totals.net", "totals.net_amount",
        "amounts.subtotal", "summary.subtotal", "net_amount", "subtotal_amount"]),
    ("TAX_AMOUNT", 100, False, "totals.tax", [
        "tax", "tax_amount", "totals.tax_amount", "totals.tax_total", "tax_total",
        "sales_tax", "totals.sales_tax", "vat", "vat_amount", "totals.vat", "totals.vat_amount",
        "taxes.total", "amounts.tax", "summary.tax"]),
    ("TAX_RATE", 100, False, "totals.tax_rate", [
        "tax_rate", "vat_rate", "sales_tax_rate", "tax_percent", "tax_percentage",
        "tax.rate", "taxes.rate", "amounts.tax_rate", "summary.tax_rate"]),
    ("DISCOUNT_AMOUNT", 100, False, "totals.discount", [
        "discount", "discount_amount", "totals.discount_amount", "discounts.total",
        "amounts.discount", "summary.discount", "total_discount", "sub_total.discount_price"]),
    ("SERVICE_CHARGE", 100, False, "totals.service_charge", [
        "service_charge", "service", "svc", "gratuity", "totals.service", "totals.service_price",
        "amounts.service_charge", "summary.service_charge", "sub_total.service_price", "service_price"]),
    ("GRAND_TOTAL", 100, False, "totals.total", [
        "total", "grand_total", "totals.grand_total", "total_amount", "totals.total_amount",
        "amount_due", "totals.amount_due", "balance_due", "totals.balance_due",
        "invoice_total", "total_due", "amounts.total", "summary.total"]),
    ("DOCUMENT_ID", 100, None, "invoice_number", [
        "document_number", "invoice_id", "invoice_no", "number", "id", "reference", "reference_number",
        "header.invoice_number", "metadata.invoice_number"]),
    ("EVENT_DATE", 90, None, "dates[*].value", [
        "dates[*].date", "service_date", "invoice_date", "issue_date", "date", "header.invoice_date"]),
    ("CURRENCY_CODE", 100, False, "currency", [
        "currency_code", "totals.currency", "amounts.currency", "header.currency", "metadata.currency"]),
    ("PRIOR_CLAIM_IDS", 100, False, "prior_invoice_ids", [
        "prior_claim_ids", "duplicate_candidates", "related_invoice_ids", "prior_invoices"]),
]

_I18N = {
    "SUBTOTAL": ["subtotal", "base_imponible", "sous_total", "soustotal", "zwischensumme", "subtotale", "subtotaal",
                 "小计", "小計", "소계", "подытог", "сумма_без_налога"],
    "TAX_AMOUNT": ["impuesto", "iva", "tva", "mwst", "steuer", "umsatzsteuer", "imposta", "imposto", "btw",
                   "税", "税额", "税額", "消費税", "세금", "налог", "ндс", "الضريبة"],
    "TAX_RATE": ["tipo_iva", "tasa_iva", "taux_tva", "steuersatz", "aliquota_iva", "taxa_iva",
                 "税率", "세율", "ставка_налога"],
    "DISCOUNT_AMOUNT": ["descuento", "remise", "rabais", "rabatt", "nachlass", "sconto", "desconto", "korting",
                        "折扣", "割引", "할인", "скидка", "الخصم"],
    "SERVICE_CHARGE": ["servicio", "cargo_por_servicio", "servizio", "bedienung", "taxe_de_service", "服务费", "サービス料"],
    "GRAND_TOTAL": ["total", "total_factura", "importe_total", "montant_total", "gesamtbetrag", "gesamt", "endbetrag", "totale",
                    "totaal", "valor_total", "合计", "总计", "合計", "합계", "총계", "итого", "всего", "المجموع", "الإجمالي"],
    "CURRENCY_CODE": ["moneda", "devise", "waehrung", "valuta", "moeda", "货币", "通貨", "валюта", "العملة"],
    "RATE_APPLIED": ["precio_unitario", "precio", "prix_unitaire", "prix", "einzelpreis", "preis", "prezzo_unitario", "prezzo",
                     "preco", "单价", "単価", "단가", "цена", "سعر_الوحدة"],
    "CLAIMED_QUANTITY": ["cantidad", "quantite", "menge", "anzahl", "quantita", "quantidade",
                         "数量", "수량", "количество", "الكمية"],
    "CLAIMED_AMOUNT": ["importe", "montant", "betrag", "importo", "valor", "gesamtpreis",
                       "金额", "金額", "금액", "сумма", "المبلغ"],
    "INVOICE_DESCRIPTION": ["descripcion", "concepto", "designation", "beschreibung", "bezeichnung", "descrizione", "descricao",
                            "articulo", "artikel", "描述", "摘要", "品名", "내역", "описание", "الوصف"],
}
_TRADE_I18N = {
    "SUBTOTAL": ["ara_toplam", "delsumma", "jumlah", "subtotal_harga"],
    "TAX_AMOUNT": ["kdv", "vergi", "moms", "skatt", "pajak", "ppn"],
    "TAX_RATE": ["kdv_orani", "momssats", "tarif_pajak"],
    "DISCOUNT_AMOUNT": ["indirim", "rabatt", "diskon", "potongan"],
    "GRAND_TOTAL": ["genel_toplam", "toplam", "totalt", "summa", "total_harga", "jumlah_total"],
    "CURRENCY_CODE": ["para_birimi", "valuta_kod", "mata_uang"],
    "RATE_APPLIED": ["birim_fiyat", "styckpris", "harga_satuan", "harga"],
    "CLAIMED_QUANTITY": ["miktar", "adet", "antal", "kuantitas", "jumlah_barang"],
    "CLAIMED_AMOUNT": ["tutar", "belopp", "nilai", "jumlah_harga"],
    "INVOICE_DESCRIPTION": ["aciklama", "beskrivning", "keterangan", "deskripsi"],
}


def _mappings():
    out = []
    for is_line, block in ((True, _LINE), (False, _DOCUMENT)):
        for role, priority, fuzzy, path, alts in block:
            alts = list(alts)
            for a in _I18N.get(role, []) + _TRADE_I18N.get(role, []):
                forms = ["line_items[*].%s" % a, "items[*].%s" % a, "lines[*].%s" % a] if is_line else [a, "totals.%s" % a]
                for f in forms:
                    if f not in alts:
                        alts.append(f)
            out.append({"role": role, "priority": priority, "fuzzy": fuzzy is not False, "path": path, "alts": alts})
    return out


# The invoice document's mappings, in the bridge's order: priority high to low, stable (binding/ontological-bridge.ts
# mappingPlanOf). The contract and evidence mappings are not here: references are outside this build.
INVOICE_MAPPINGS = sorted(_mappings(), key=lambda m: -m["priority"])

# ---------------------------------------------------------------------------------------------------------------------
# Laws: packages/verify/src/rulesets/invoice/axioms.ts and packages/verify/src/kernel/axiom-registry.ts

AXIOMS = {
    "SUM_INT": {"name": "Law of Footing", "formal": "Σ line_items[i].amount = subtotal", "detectable": "PRECOMPUTE",
                "predicates": [("LINE_ITEMS_SUM", "=", "SUBTOTAL", 0.01)], "required": ["LINE_ITEMS_SUM", "SUBTOTAL"]},
    "TOTAL_INT": {"name": "Law of the Bottom Line", "formal": "grand_total = subtotal + tax − discount", "detectable": "PRECOMPUTE",
                  "predicates": [("GRAND_TOTAL", "=", "EXPECTED_GRAND_TOTAL", 0.01)], "required": ["GRAND_TOTAL", "EXPECTED_GRAND_TOTAL"]},
    "TAX_INT": {"name": "Law of the Levy", "formal": "tax = subtotal × tax_rate", "detectable": "PRECOMPUTE",
                "predicates": [("TAX_AMOUNT", "=", "EXPECTED_TAX_AMOUNT", 0.01)], "required": ["TAX_AMOUNT", "EXPECTED_TAX_AMOUNT"]},
    "TIME_ORD": {"name": "Law of Temporal Order", "formal": "∀t: contract_start ≤ t_event ≤ contract_end", "detectable": "PRECOMPUTE",
                 "predicates": [("EVENT_DATE", ">=", "CONTRACT_START", None), ("EVENT_DATE", "<=", "CONTRACT_END", None)],
                 "required": ["EVENT_DATE", "CONTRACT_START", "CONTRACT_END"]},
    "MATH_INT": {"name": "Law of Mathematical Integrity", "formal": "∀a: a_claimed = a_calculated", "detectable": "PRECOMPUTE",
                 "predicates": [("CLAIMED_AMOUNT", "=", "VERIFIED_AMOUNT", 0.01)], "required": ["CLAIMED_AMOUNT", "VERIFIED_AMOUNT"]},
    "RATE_SUP": {"name": "Law of Rate Supremacy", "formal": "∀r: r_applied ≤ r_contracted", "detectable": "PRECOMPUTE",
                 "predicates": [("RATE_APPLIED", "<=", "RATE_CONTRACTED", 0.01)], "required": ["RATE_APPLIED", "RATE_CONTRACTED"]},
    "AMT_CAP": {"name": "Law of Amount Cap", "formal": "∀a: a_claimed ≤ a_max", "detectable": "PRECOMPUTE",
                "predicates": [("CLAIMED_AMOUNT", "<=", "CONTRACTED_LIMIT", 0.01)], "required": ["CLAIMED_AMOUNT", "CONTRACTED_LIMIT"]},
    "QTY_MATCH": {"name": "Law of Quantity Match", "formal": "∀q: q_claimed = q_verified", "detectable": "PRECOMPUTE",
                  "predicates": [("CLAIMED_QUANTITY", "=", "ACTUAL_QUANTITY", 0.001)], "required": ["CLAIMED_QUANTITY", "ACTUAL_QUANTITY"]},
}

# packages/verify/src/rulesets/invoice/index.ts
DOCUMENT_CODES = ["SUM_INT", "TOTAL_INT", "TAX_INT", "TIME_ORD"]
LINE_CODES = ["MATH_INT", "RATE_SUP", "AMT_CAP", "QTY_MATCH"]
KIND_BY_CODE = {
    "SUM_INT": "RECOMPUTE", "TOTAL_INT": "RECOMPUTE", "TAX_INT": "RECOMPUTE", "MATH_INT": "RECOMPUTE",
    "RATE_SUP": "CROSS_REFERENCE", "AMT_CAP": "CROSS_REFERENCE", "TIME_ORD": "CROSS_REFERENCE", "QTY_MATCH": "CROSS_REFERENCE",
    "DUP_PROHIB": "CONSISTENCY",
}
FIELD_BY_CODE = {
    "SUM_INT": "subtotal", "TOTAL_INT": "total", "TAX_INT": "tax", "MATH_INT": "amount",
    "RATE_SUP": "unit_price", "AMT_CAP": "amount", "TIME_ORD": "service_date", "QTY_MATCH": "quantity",
    "DUP_PROHIB": "invoice_number",
}
REFERENCE_ROLES = {
    "contract": ["RATE_CONTRACTED", "CONTRACTED_LIMIT", "CONTRACT_START", "CONTRACT_END"],
    "evidence": ["ACTUAL_QUANTITY", "VERIFIED_AMOUNT", "EVIDENCE_DESCRIPTION"],
    "history": [],
}
COMPUTED_ROLES = ["LINE_ITEMS_SUM", "EXPECTED_GRAND_TOTAL", "EXPECTED_TAX_AMOUNT", "LINE_ITEM_TOTAL", "EXPECTED_TOTAL"]
# The ruleset's default tolerance, CAPPED (packages/verify/src/tolerance.ts)
DEFAULT_TOLERANCE = {"rel": 0.0003, "absCap": 0, "roundingCap": {"perLine": ["TAX_INT"], "cashStep": ["TOTAL_INT"]}}

# packages/verify/src/kernel/validation-gavel.ts getRoleHint
ROLE_HINTS = {
    "RATE_APPLIED": "the rate/unit price from the invoice",
    "RATE_CONTRACTED": "the contracted rate from the contract",
    "CLAIMED_AMOUNT": "the billed/invoiced amount",
    "VERIFIED_AMOUNT": "the verified amount from evidence",
    "CONTRACTED_LIMIT": "the maximum allowed amount from contract",
    "CLAIMED_QUANTITY": "the quantity claimed on the invoice",
    "ACTUAL_QUANTITY": "the actual quantity from evidence (field tickets)",
    "EVENT_DATE": "the service date from the invoice",
    "CONTRACT_START": "the contract effective/start date",
    "CONTRACT_END": "the contract expiration/end date",
    "DOCUMENT_ID": "the invoice or document number",
    "PRIOR_CLAIM_IDS": "prior_invoice_ids — an array of previously seen invoice numbers, supplied by the caller, for duplicate detection",
    "LINE_ITEM_TOTAL": "the computed line item total",
    "EXPECTED_TOTAL": "the expected total based on contract rates",
    "INVOICE_DESCRIPTION": "the service description from the invoice",
    "EVIDENCE_DESCRIPTION": "the service description from evidence",
    "SUBTOTAL": "the stated subtotal from the invoice",
    "TAX_AMOUNT": "the stated tax amount from the invoice",
    "TAX_RATE": "the stated tax rate from the invoice",
    "DISCOUNT_AMOUNT": "the stated discount from the invoice",
    "GRAND_TOTAL": "the stated grand total from the invoice",
    "LINE_ITEMS_SUM": "the sum of line item amounts (computed)",
    "CURRENCY_CODE": "the ISO-4217 currency code",
}

# packages/verify/src/verdict/cant-tell.ts
CANT_TELL_WHAT = {
    "TIME_ORD": "whether the service date falls within the contract's term",
    "SUM_INT": "whether the line amounts add up to the subtotal",
    "TOTAL_INT": "whether the total equals the subtotal plus tax, less any discount",
    "TAX_INT": "whether the tax equals the subtotal times the tax rate",
    "MATH_INT": "whether the line's amount matches its quantity times its unit price",
    "RATE_SUP": "whether the unit price is within the contract's rate",
    "QTY_MATCH": "whether the quantity billed matches the quantity delivered",
    "AMT_CAP": "whether the line's amount stays within the contracted limit",
    "DUP_PROHIB": "whether this invoice was already billed",
}

# packages/verify/src/verdict/scope.ts
SCOPE_STATEMENTS = ["advisories are counsel, not verdicts", "this is a check, not a decision"]

# The explanations in a controller's words, every engine after 0.7.0: packages/verify/src/rulesets/invoice/words.ts
# What each check asks, written as the relation a controller checks (CHECK)
WORDS_CHECK = {
    "SUM_INT": "subtotal = the sum of the line amounts",
    "TOTAL_INT": "total = subtotal + tax − discount",
    "TAX_INT": "tax = subtotal × tax rate",
    "MATH_INT": "amount = quantity × unit price",
    "RATE_SUP": "unit price ≤ the contract's rate",
    "AMT_CAP": "amount ≤ the contracted limit",
    "QTY_MATCH": "quantity billed = quantity delivered",
    "TIME_ORD": "the service date falls within the contract's term",
}
# The checks whose two figures are the invoice's own and the one computed from it (RECOMPUTE)
WORDS_RECOMPUTE = ("SUM_INT", "TOTAL_INT", "TAX_INT", "MATH_INT")
# Where a cross-reference check's second figure comes from (AGAINST)
WORDS_AGAINST = {"RATE_SUP": "in the contract", "AMT_CAP": "in the contract", "QTY_MATCH": "on the delivery record"}
# What a role the kernel names is, for a person (ROLE_WORDS); any other role is written in lower case with spaces
ROLE_WORDS = {
    "EVENT_DATE": "the service date on the invoice", "CONTRACT_START": "the contract's start date", "CONTRACT_END": "the contract's end date",
    "RATE_CONTRACTED": "a contract rate for this line", "CONTRACTED_LIMIT": "a contracted limit for this line",
    "ACTUAL_QUANTITY": "a delivered quantity for this line (a receipt or delivery record)",
    "SUBTOTAL": "the subtotal", "TAX_AMOUNT": "the tax", "TAX_RATE": "the tax rate", "GRAND_TOTAL": "the total", "DISCOUNT_AMOUNT": "the discount",
    "LINE_ITEMS_SUM": "the line amounts", "EXPECTED_GRAND_TOTAL": "the subtotal plus tax, less any discount", "EXPECTED_TAX_AMOUNT": "the subtotal times the tax rate",
    "CLAIMED_AMOUNT": "the line's amount", "VERIFIED_AMOUNT": "the line's quantity times its unit price", "UNIT_PRICE": "the unit price", "QUANTITY": "the quantity",
}

# ---------------------------------------------------------------------------------------------------------------------
# The remedy table: packages/verify/src/rulesets/invoice/axioms.ts INVOICE_REMEDIES, key for key in the engine's order.

REMEDY_TABLE = {
    "SUM_INT": {
        "fail": [
            {"kind": "recompute-with", "operand": {"source": "invoice", "role": "SUBTOTAL", "path": "subtotal"},
             "detail": "The line amounts sum to {asserted}; the subtotal says {expected} (the lines are off by {variance}). Re-read the subtotal and every line amount: a dropped, doubled or misread line is the usual cause."},
            {"kind": "authority", "authority": "ap-supervisor",
             "detail": "If the document itself does not foot, a person with AP authority may rule to proceed on it as stated, or send it back to the vendor for a corrected one. The ruling covers this verdict only."},
        ],
    },
    "TOTAL_INT": {
        "fail": [
            {"kind": "recompute-with", "operand": {"source": "invoice", "role": "GRAND_TOTAL", "path": "total"},
             "detail": "Subtotal + tax + service charge − discount is {expected}; the total says {asserted} (off by {variance}). Re-read the total, the tax, any service charge and any discount."},
            {"kind": "missing-operand", "operand": {"source": "invoice", "role": "SERVICE_CHARGE", "path": "service_charge"},
             "detail": "A charge the total includes but the extraction did not carry (shipping, handling, a fee) closes the gap only if the document states it: extract it as service_charge."},
            {"kind": "transform", "transform": "tax-inclusive-subtotal", "operand": {"source": "invoice", "role": "SUBTOTAL", "path": "subtotal"},
             "detail": "If the document says its prices include tax, read the subtotal as tax-inclusive, so the tax is not added twice."},
            {"kind": "authority", "authority": "ap-supervisor",
             "detail": "A person with AP authority may rule to pay the total as stated, or send the invoice back. The ruling covers this verdict only."},
        ],
    },
    "TAX_INT": {
        "fail": [
            {"kind": "recompute-with", "operand": {"source": "invoice", "role": "TAX_AMOUNT", "path": "tax"},
             "detail": "Subtotal × tax rate is {expected}; the tax says {asserted}. Re-read the tax and the rate."},
            {"kind": "authority", "authority": "tax-reviewer",
             "detail": "The rule taxes the whole subtotal at one rate. Exempt lines, several rates or another taxable base are outside it: a person with tax authority rules, for this verdict only."},
        ],
    },
    "MATH_INT": {
        "fail": [
            {"kind": "recompute-with", "operand": {"source": "invoice", "path": "line_items[{line}]"},
             "detail": "Line {line}: unit price × quantity is {expected}; the amount says {asserted}. Re-read the quantity, unit price and amount. A line discount or another unit of measure is the usual cause; if the document is wrong, the vendor reissues it."},
            {"kind": "authority", "authority": "ap-supervisor",
             "detail": "A person with AP authority may accept line {line} as stated, for this verdict only."},
        ],
    },
    "RATE_SUP": {
        "fail": [
            {"kind": "authority", "authority": "contract-owner",
             "detail": "Billed at {op:RATE_APPLIED} against the contracted {op:RATE_CONTRACTED}. The contract owner may approve the difference for this verdict only; that sets no new rate."},
            {"kind": "missing-operand", "operand": {"source": "contract", "role": "RATE_CONTRACTED"},
             "detail": "A contract amendment at the billed rate, supplied as the contract reference: the invoice is then checked as a new verdict."},
        ],
    },
    "AMT_CAP": {
        "fail": [
            {"kind": "authority", "authority": "budget-owner",
             "detail": "The amount {asserted} is over the contracted limit {expected}. The budget owner may approve the overrun for this verdict only."},
            {"kind": "missing-operand", "operand": {"source": "contract", "role": "CONTRACTED_LIMIT"},
             "detail": "An amendment raising the limit, supplied as the contract reference: the invoice is then checked as a new verdict."},
        ],
    },
    "TIME_ORD": {
        "fail": [
            {"kind": "missing-operand", "operand": {"source": "contract", "role": "CONTRACT_END"},
             "detail": "The service date {asserted} is outside the contract term. An extension or renewal that covers it, supplied as the contract reference, is checked as a new verdict."},
            {"kind": "authority", "authority": "contract-owner",
             "detail": "The contract owner may approve work outside the term, for this verdict only."},
        ],
    },
    "QTY_MATCH": {
        "fail": [
            {"kind": "missing-operand", "operand": {"source": "evidence", "role": "ACTUAL_QUANTITY"},
             "detail": "Billed {asserted}; the delivery evidence shows {expected}. Evidence for the remaining units (a later delivery ticket or receipt) is checked as a new verdict."},
            {"kind": "authority", "authority": "buyer",
             "detail": "The buyer may approve paying units the evidence does not show, for this verdict only."},
        ],
    },
    "DUP_PROHIB": {
        "abstain": [
            {"kind": "missing-operand", "operand": {"source": "history", "role": "PRIOR_CLAIM_IDS", "path": "prior_invoice_ids"}, "when": ["FIELD_MISSING"],
             "detail": "The invoice numbers already processed (prior_invoice_ids; an empty list means none), and the invoice number itself, so the duplicate check can run."},
        ],
        "fail": [
            {"kind": "authority", "authority": "ap-controller",
             "detail": "Invoice {asserted} is already in the history. Paying it again is lawful only if the earlier booking was voided or credited: the controller rules, for this verdict only."},
        ],
    },
    "DUP_NEAR": {
        "fail": [
            {"kind": "authority", "authority": "ap-clerk",
             "detail": "A prior invoice number differs from {asserted} only by formatting or a revision suffix. A person confirms this is a new invoice, not a re-issue, for this verdict only."},
        ],
    },
}

# The hash every engine 0.6.0, 0.7.0, 0.7.1 and 0.7.2 invoice@0.1.0 verdict carries (conformance/vectors/01-valid-invoice-0.6.0.json). engine.py
# checks the table above against it, so a transcription slip is caught before any verdict is written.
EXPECTED_REMEDY_TABLE_HASH = "fef8580e40882b801fab640a89aeb7f27a2167cccd889c870fd1f4036c58190e"
