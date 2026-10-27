// Activity roles for bpi-threeway-messages@1.0.0 (PREREG Amendment A). Exact strings from results/schema.json.
// Settled on the dev slice only (traces < 1500); see Amendment A for the case ids that decided each line.
export const MAPPING = {
  valueKey: 'Cumulative net worth (EUR)', // NOT an operand: it is the item's net worth repeated on every event (Q1)
  categories: {
    '3-way match, invoice after GR': 'threeway_after',
    '3-way match, invoice before GR': 'threeway_before',
    '2-way match': 'twoway',
    'Consignment': 'consignment',
  },
  consignmentItemTypes: ['Consignment'],
  poCreate: ['Create Purchase Order Item'],
  receiptAdd: ['Record Goods Receipt'],
  receiptRemove: ['Cancel Goods Receipt'],
  serviceEntry: ['Record Service Entry Sheet'], // counted as receipt ONLY when the trace has no goods-receipt event (Q2)
  invoiceAdd: ['Record Invoice Receipt'], // the posted invoice (Q3); vendor-side events are not posted invoices
  invoiceRemove: ['Cancel Invoice Receipt'],
  subsequentAdd: ['Record Subsequent Invoice'], // price/value adjustments: no receipt of their own; counted for consignment only
  subsequentRemove: ['Cancel Subsequent Invoice'],
  clear: ['Clear Invoice'],
  paymentBlock: ['Set Payment Block', 'Remove Payment Block'], // blocks are mostly set implicitly; a removal proves one existed
}
