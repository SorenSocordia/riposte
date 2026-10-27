/**
 * Construction ERP mappings for the shadow pilot (2026-10-05). A subcontractor's bills live in a construction
 * ERP; the pilot reads CSV exports through a mapping file (mappers.ts applyMapping) laid over the generic-csv source, whose
 * columns are this package's own field names. For each system this table says, honestly, what is known:
 *
 *   - a mapping is DRAFTED only where the system's column or field names were read in raw text from a vendor publication,
 *     named here with its date. No drafted mapping has been checked against a real export: each is a starting point a
 *     buyer checks column by column against their own file (HOW-TO-MAP.md), never a verified preset;
 *   - where no published names were found, nothing is drafted, and the status says why.
 *
 * What was read (2026-10-05):
 *   Viewpoint Vista (Trimble): the field names of the Trimble App Xchange "Vista Accounts Payable v2" and "Vista Purchase
 *     Order v2" Direct API specifications, which name the Vista views they map to (APUI/APUL unapproved invoices, POHD/POIT
 *     purchase orders, PORD receipts). These are API field names, not Vista's own import template, which was not reached.
 *   QuickBooks Desktop (Intuit): the IIF headers of Intuit's own sample files (bill, purchase order, item receipt) and its
 *     IIF header help. The published bill layout has no purchase-order link and no item or unit price on its lines.
 *   Sage 300 Construction and Real Estate, Viewpoint Spectrum, Foundation: no published column list was reached.
 */
import type { CsvFileKind } from './mappers.js'

export interface ErpMapping {
  id: string
  name: string
  status: string
  /** where the names came from (absent when none were found) */
  source?: { what: string; urls: string[]; read: string }
  /** the drafted mapping file (mappers.ts applyMapping's format), over --source generic-csv */
  mapping?: { source: 'generic-csv'; files?: Partial<Record<CsvFileKind, string>>; columns: Partial<Record<CsvFileKind, Record<string, string>>>; status?: { pay: string[]; hold: string[] }; ignore?: string[] }
  /** what a buyer must know before trusting the draft */
  notes: string[]
}

const NOT_VERIFIED = 'not verified on a real export'

export const ERP_MAPPINGS: readonly ErpMapping[] = [
  {
    id: 'vista',
    name: 'Viewpoint Vista (Trimble)',
    status: `mapping drafted from published column names; ${NOT_VERIFIED}`,
    source: {
      what: 'Trimble App Xchange Direct API specifications: Vista Accounts Payable v2 (unapproved invoices, views APUI/APUL) and Vista Purchase Order v2 (po_headers POHD, po_lines POIT, receipts PORD). API field names, not the Vista import template.',
      urls: [
        'https://direct-api.xchange.trimble.com/reference/post-directsubscriberssubscriber_codevistaap2dataunapproved_invoicescachesearchsearch',
        'https://direct-api.xchange.trimble.com/reference/get-directsubscriberssubscriber_codevistapo2datareceiptscache',
      ],
      read: '2026-10-05',
    },
    mapping: {
      source: 'generic-csv',
      columns: {
        // one row per invoice line: the APUI header fields repeated on each APUL line; ECM is the unit UnitCost is per, UM the unit of measure
        bills: { ref: 'KeyID', invoice_number: 'APRef', vendor: 'Vendor', date: 'InvDate', total: 'InvTotal', po: 'PO', line_id: 'Line', item: 'POItem', description: 'Description', quantity: 'Units', rate: 'UnitCost', amount: 'GrossAmt', price_per: 'ECM', unit: 'UM' },
        // one row per PO line: POHD fields repeated on each POIT line; the current (change-ordered) quantity, price and its ECM
        purchase_orders: { ref: 'KeyID', number: 'PO', vendor: 'Vendor', line_id: 'POItem', item: 'POItem', description: 'Description', quantity: 'CurUnits', rate: 'CurUnitCost', amount: 'CurCost', price_per: 'CurECM', unit: 'UM' },
        // one row per receipt (PORD): the PO line it receives is POItem
        item_receipts: { ref: 'KeyID', number: 'Receiver#', po: 'PO', date: 'RecvdDate', item: 'POItem', quantity: 'RecvdUnits' },
      },
      // InvStatus (0 Not Ready, 1 Ready) is not a paid or held decision: no status is read, so every bill counts as open
      status: { pay: [], hold: [] },
      // identifiers and accounting codes the check does not need; columns that change an amount are deliberately NOT here
      ignore: ['APCo', 'UIMth', 'UISeq', 'VendorGroup', 'InvStatus', 'PayControl', 'PayMethod', 'CMCo', 'CMAcct', 'GLCo', 'GLAcct', 'JCCo', 'Job', 'PhaseGroup', 'Phase', 'JCCType', 'POCo', 'Mth', 'POTrans', 'MatlGroup', 'Material', 'VendMatId'],
    },
    notes: [
      'Bills match their PO lines on POItem (the PO line number), on the bill, the PO and the receipt alike: each bill line must carry its PO and POItem (APUL LineType 6, PO lines).',
      'UnitCost and CurUnitCost are per ECM unit (E each, C per hundred, M per thousand). The draft reads ECM on the bill and CurECM on the PO line as the price unit, and divides a rate per hundred by 100 and a rate per thousand by 1,000 to a price per unit (wire priced per thousand feet is checked per foot). A value that is none of E, C or M sends the bill to a person, naming it; a blank one reads as each, unless the line\'s amount says otherwise (then a person reads it).',
      'UM, the unit of measure, is read on the bill and on the PO line (Vista defaults the bill\'s UM from the PO). When both carry one and they differ, the bill goes to a person, naming both units; nothing is converted between units.',
      'MiscAmt, TaxAmt, Retainage and Discount change what is payable and are left unmapped on purpose: the dry run lists them, and you decide how each is handled before acknowledging it.',
      'A CSV that joins header and line rows has two Description and two KeyID columns: rename the header ones (or drop them) so each name is used once.',
      'No currency field is published: every amount is read as the bill\'s currency, unnamed.',
      'Your paid or held decision is not in these fields (InvStatus is Ready / Not Ready): without a status column every bill is open and the agreement table stays empty. Posted invoices (APTH) carry OpenYN, which is not mapped here.',
      'POIT carries InvUnits, the units invoiced on each PO line. Mapped as invoiced_quantity it nets each bill line by line, but only from an export taken before the month\'s bills are posted: a posted bill is already in InvUnits, and a bill counted there would be netted against itself. It is not mapped here.',
    ],
  },
  {
    id: 'quickbooks-desktop',
    name: 'QuickBooks Desktop (Intuit)',
    status: `published IIF headers read; no mapping drafted, because the published bill layout carries no purchase-order link and no item or unit price on its lines, so a bill cannot be matched to its PO from it; ${NOT_VERIFIED}`,
    source: {
      what: 'Intuit\'s IIF sample files for a bill (TRNSTYPE BILL), a purchase order (PURCHORD) and an item receipt (ITEMRECEIPT), with Intuit\'s IIF header help. These are import templates.',
      urls: ['https://http-download.intuit.com/http.intuit/OpenCms/sites/default/QBSupportSite/executables/IIF/bill.zip', 'https://http-download.intuit.com/http.intuit/OpenCms/sites/default/QBSupportSite/executables/IIF/purchase_order.zip', 'https://http-download.intuit.com/http.intuit/OpenCms/sites/default/QBSupportSite/executables/IIF/item_receipt.zip'],
      read: '2026-10-05',
    },
    notes: [
      'IIF is a tab-separated file with !TRNS / !SPL header rows and TRNS, SPL, ENDTRNS records: not a CSV with one header row, so the CSV sources cannot read it as it is.',
      'In the bill samples the lines (SPL) carry QNTY, MEMO and AMOUNT but no item and no unit price, and PONUM is defined for invoices and credit memos only. A report export that carries the PO number and item on each bill line is the way in; its column names are your report\'s, so write the mapping from your own file (HOW-TO-MAP.md).',
    ],
  },
  {
    id: 'sage-300-cre',
    name: 'Sage 300 Construction and Real Estate (formerly Timberline)',
    status: `no published column list found (2026-10-05: the vendor's knowledgebase is behind a sign-in); not drafted; ${NOT_VERIFIED}`,
    notes: ['Write the mapping from your own AP invoice and PO export (HOW-TO-MAP.md).'],
  },
  {
    id: 'spectrum',
    name: 'Viewpoint Spectrum (Trimble)',
    status: `no published column list found (2026-10-05: the field layouts of its Data Exchange web services are behind a captcha on the vendor's help site); not drafted; ${NOT_VERIFIED}`,
    notes: ['Write the mapping from your own AP invoice and PO export (HOW-TO-MAP.md).'],
  },
  {
    id: 'foundation',
    name: 'Foundation Software',
    status: `no published column list found (2026-10-05: the vendor's public site has no import or export layout); not drafted; ${NOT_VERIFIED}`,
    notes: ['Write the mapping from your own AP invoice and PO export (HOW-TO-MAP.md).'],
  },
]

/**
 * A drafted mapping as the file `--mapping` reads, with its notes (2026-10-06: the file carries them under "notes", which
 * applyMapping reads out with every dry run and run, and acts on nothing in them).
 */
export function erpMappingFile(e: ErpMapping): string {
  if (!e.mapping) throw new Error(`no mapping is drafted for ${e.name}`)
  return `${JSON.stringify({ ...e.mapping, notes: e.notes }, null, 2)}\n`
}
