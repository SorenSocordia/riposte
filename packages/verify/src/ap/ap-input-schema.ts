/**
 * The AP input's JSON Schema (draft 2020-12), version riposte.ap-input/0.1.0. Field names follow Ramp's public Developer API
 * objects (Bill, ApiBillInventoryLineItem, ApiPurchaseOrderResource, ApiPurchaseOrderLineItem, ApiItemReceiptResource,
 * ApiItemReceiptLineItem, CurrencyAmount; https://docs.ramp.com/openapi/developer-api.json) wherever Ramp has the field.
 * The field map, with what was and was not verified, is docs/AP-INPUT.md. docs/ap-input.schema.json is this object, written
 * out; a test keeps the two identical.
 *
 * 2026-10-05, additive and optional: vendor.tax_id, payment_history[].vendor_id and .vendor_tax_id. An input
 * without them is unchanged; under engine 0.6.0 the duplicate check compares tax id, then vendor id, then the normalized name.
 * 2026-10-05, additive and optional: payment_history[].no_purchase_order (true: booked without a purchase
 * order). Engine 0.6.0's PO balance check does not count such a row against an order; a row with no PO number that does not
 * say so may be on this order, and is counted as if it were.
 * 2026-10-05, additive and optional: purchase_order.tax_rate (the PO's tax terms, a fraction from 0 to 1; 0
 * states that no tax is due; absent, the PO does not say) and purchase_order.line_items[].taxable (false: the line is not taxed).
 * Engine 0.6.0's tax check reads them; an input without them is unchanged.
 * 2026-10-06, additive and optional: purchase_order.line_items[].invoiced_quantity_to_date (the quantity earlier
 * bills invoiced on the PO line, not counting this one). Engine 0.6.0's billed-to-date check reads it; an input without it is
 * unchanged.
 *
 * The schema states the shape. validateApInput (./structured.ts) also checks what a schema cannot: unique PO line ids,
 * receipt lines naming PO lines on this PO, one currency per document, a currency for minor-unit amounts, the receipt-line cap.
 */
const nullable = (s: Record<string, unknown>): Record<string, unknown> => ({ anyOf: [s, { type: 'null' }] })
const ref = (name: string): Record<string, unknown> => ({ $ref: `#/$defs/${name}` })

export const AP_INPUT_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:riposte:ap-input:0.1.0',
  title: 'Riposte AP input 0.1.0',
  description: 'A bill, its purchase order and its item receipts as structured data, for the three-way match (ruleset ap-structured@0.1.0). Optional: payment history (enables the duplicate check) and the model decision the gate checks.',
  type: 'object',
  required: ['schema', 'bill', 'purchase_order', 'item_receipts'],
  additionalProperties: false,
  properties: {
    schema: { const: 'riposte.ap-input/0.1.0' },
    bill: ref('bill'),
    purchase_order: ref('purchase_order'),
    item_receipts: { type: 'array', maxItems: 1000, items: ref('item_receipt') },
    payment_history: nullable({ type: 'array', maxItems: 10000, items: ref('payment') }),
    decision: nullable(ref('decision')),
  },
  $defs: {
    id: { type: 'string', minLength: 1, maxLength: 256, pattern: '\\S' },
    text: { type: 'string', maxLength: 1024 },
    date: { type: 'string', minLength: 1, maxLength: 64, pattern: '\\S' },
    currency: { type: 'string', pattern: '^[A-Z]{3}$', description: 'ISO 4217' },
    minor_amount: {
      type: 'object', required: ['amount'], additionalProperties: false,
      description: "Minor units, as Ramp's CurrencyAmount: amount 12034 with currency_code USD is 120.34.",
      properties: {
        amount: { oneOf: [{ type: 'integer', minimum: -9007199254740991, maximum: 9007199254740991 }, { type: 'string', pattern: '^-?[0-9]{1,17}$' }] },
        currency_code: ref('currency'),
        minor_unit_conversion_rate: nullable({ enum: [1, 10, 100, 1000, 10000] }),
      },
    },
    money: {
      description: 'A JSON number or a decimal string in major units, or an amount in minor units.',
      oneOf: [{ type: 'number', minimum: -1e12, maximum: 1e12 }, { type: 'string', pattern: '^-?[0-9]{1,15}(\\.[0-9]{1,6})?$' }, ref('minor_amount')],
    },
    price: {
      description: 'A non-negative money value.',
      oneOf: [
        { type: 'number', minimum: 0, maximum: 1e12 },
        { type: 'string', pattern: '^[0-9]{1,15}(\\.[0-9]{1,6})?$' },
        { type: 'object', required: ['amount'], additionalProperties: false, properties: {
          amount: { oneOf: [{ type: 'integer', minimum: 0, maximum: 9007199254740991 }, { type: 'string', pattern: '^[0-9]{1,17}$' }] },
          currency_code: ref('currency'),
          minor_unit_conversion_rate: nullable({ enum: [1, 10, 100, 1000, 10000] }),
        } },
      ],
    },
    quantity: { oneOf: [{ type: 'number', minimum: 0, maximum: 1e12 }, { type: 'string', pattern: '^[0-9]{1,15}(\\.[0-9]{1,6})?$' }] },
    vendor: { type: 'object', additionalProperties: false, properties: { id: nullable(ref('id')), name: nullable({ type: 'string', minLength: 1, maxLength: 1024, pattern: '\\S' }), tax_id: nullable(ref('id')) } },
    bill_line: {
      type: 'object', required: ['amount'], additionalProperties: false,
      properties: {
        id: nullable(ref('id')),
        purchase_order_line_item_id: nullable(ref('id')),
        sku: nullable(ref('id')),
        description: nullable(ref('text')),
        memo: nullable(ref('text')),
        quantity: nullable(ref('quantity')),
        unit_price: nullable(ref('price')),
        amount: ref('money'),
        discount_amount: nullable(ref('money')),
        discount_rate: nullable({ oneOf: [{ type: 'number' }, { type: 'string', pattern: '^-?[0-9]{1,15}(\\.[0-9]{1,6})?$' }] }),
      },
    },
    bill: {
      type: 'object', required: ['invoice_number', 'vendor', 'amount', 'line_items'], additionalProperties: false,
      properties: {
        id: nullable(ref('id')),
        invoice_number: ref('id'),
        vendor: ref('vendor'),
        purchase_order_number: nullable(ref('id')),
        currency: nullable(ref('currency')),
        amount: ref('money'),
        freight: nullable(ref('money')),
        tax: nullable(ref('money')),
        issued_at: nullable(ref('date')),
        line_items: { type: 'array', minItems: 1, maxItems: 1000, items: ref('bill_line') },
      },
    },
    po_line: {
      type: 'object', required: ['id', 'unit_price'], additionalProperties: false,
      properties: {
        id: ref('id'),
        sku: nullable(ref('id')),
        external_id: nullable(ref('id')),
        description: nullable(ref('text')),
        quantity: nullable(ref('quantity')),
        unit_price: ref('price'),
        amount: nullable(ref('money')),
        taxable: nullable({ type: 'boolean', description: 'false: this line is not taxed. Absent or true: taxed when the purchase order states a tax_rate.' }),
        // the quantity earlier bills invoiced on this PO line, not counting this one (docs/AP-INPUT.md)
        invoiced_quantity_to_date: nullable(ref('quantity')),
      },
    },
    purchase_order: {
      type: 'object', required: ['purchase_order_number', 'line_items'], additionalProperties: false,
      properties: {
        id: nullable(ref('id')),
        purchase_order_number: ref('id'),
        vendor: nullable(ref('vendor')),
        currency: nullable(ref('currency')),
        freight_allowed: { type: ['boolean', 'null'] },
        tax_rate: nullable({ type: 'number', minimum: 0, maximum: 1, description: "The purchase order's tax terms as a fraction (0.0825 is 8.25%). 0 states that no tax is due, so tax billed holds (hold_total); absent, the order does not say, so tax billed goes to a person." }),
        line_items: { type: 'array', minItems: 1, maxItems: 1000, items: ref('po_line') },
      },
    },
    receipt_line: {
      type: 'object', required: ['purchase_order_line_item_id', 'quantity'], additionalProperties: false,
      properties: { id: nullable(ref('id')), purchase_order_line_item_id: ref('id'), quantity: ref('quantity') },
    },
    item_receipt: {
      type: 'object', required: ['line_items'], additionalProperties: false,
      properties: {
        id: nullable(ref('id')),
        item_receipt_number: nullable(ref('id')),
        purchase_order_id: nullable(ref('id')),
        received_at: nullable(ref('date')),
        line_items: { type: 'array', minItems: 1, maxItems: 1000, items: ref('receipt_line') },
      },
    },
    payment: {
      type: 'object', required: ['invoice_number'], additionalProperties: false,
      properties: {
        invoice_number: ref('id'),
        vendor: nullable({ type: 'string', minLength: 1, maxLength: 1024, pattern: '\\S' }),
        vendor_id: nullable(ref('id')),
        vendor_tax_id: nullable(ref('id')),
        purchase_order_number: nullable(ref('id')),
        no_purchase_order: nullable({ type: 'boolean', description: 'true: the invoice was booked without a purchase order (a non-PO bill), so the PO balance check does not count it against any order. Never with purchase_order_number.' }),
        amount: nullable(ref('money')),
        paid_at: nullable(ref('date')),
      },
    },
    decision: {
      type: 'object', required: ['action'], additionalProperties: false,
      properties: {
        action: { enum: ['pay', 'hold'] },
        reason: nullable({ enum: ['hold_duplicate', 'hold_no_po', 'hold_quantity', 'hold_price', 'hold_line_math', 'hold_total'] }),
        confidence: nullable({ type: 'number', minimum: 0, maximum: 1 }),
        rationale: nullable({ type: 'string', maxLength: 4000 }),
        model: nullable(ref('id')),
      },
    },
  },
} as const
