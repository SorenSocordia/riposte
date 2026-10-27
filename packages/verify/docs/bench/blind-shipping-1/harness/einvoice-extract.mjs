// blind-shipping-1, e-invoice arm (PREREG.md sections 4.2 and 9): the fixed mapping from a UBL 2.1 Invoice or CreditNote to
// the extraction the engine reads. Field by field, from the UBL element that
// `node packages/verify/dist/cli.js extract-schema peppol-en16931@0.3.0` names for each field (its "description" and
// "x-paths"; the line fields under "lines"). The arm measures the rulesets on a correct reading of the document, so this
// reads the XML and nothing else: no engine code, no guessing, no repair.
//
//   node harness/einvoice-extract.mjs --in <file.xml> [--out <extraction.json>]
//   node harness/einvoice-extract.mjs --items <items.json> --base <dir> --out <dir>     (items: [{ "id", "file" }])
//
// THE MAPPING (fixed; every path below is relative to the root element, Invoice or CreditNote, by namespace, not prefix)
//   invoice_number          INVOICE_NUMBER  BT-1    cbc:ID
//   issue_date              ISSUE_DATE      BT-2    cbc:IssueDate
//   currency                DOC_CURRENCY    BT-5    cbc:DocumentCurrencyCode
//   amount_currency         AMOUNT_CURRENCY         @currencyID of the amounts under cac:LegalMonetaryTotal: their one value
//                                                   when they agree; when they differ, the first in document order that is
//                                                   not BT-5's value
//   line_extension_amount   SUM_LINE_NET    BT-106  cac:LegalMonetaryTotal/cbc:LineExtensionAmount
//   allowance_total_amount  ALLOWANCE       BT-107  cac:LegalMonetaryTotal/cbc:AllowanceTotalAmount
//   charge_total_amount     CHARGE          BT-108  cac:LegalMonetaryTotal/cbc:ChargeTotalAmount
//   tax_exclusive_amount    TAX_EXCL        BT-109  cac:LegalMonetaryTotal/cbc:TaxExclusiveAmount
//   tax_amount              TAX_AMT         BT-110  cac:TaxTotal/cbc:TaxAmount, of the one cac:TaxTotal whose TaxAmount's
//                                                   @currencyID is BT-5's value (the reading BR-CO-15 uses); with no BT-5,
//                                                   of the only cac:TaxTotal if there is one
//   tax_inclusive_amount    TAX_INCL        BT-112  cac:LegalMonetaryTotal/cbc:TaxInclusiveAmount
//   prepaid_amount          PREPAID         BT-113  cac:LegalMonetaryTotal/cbc:PrepaidAmount
//   payable_rounding_amount ROUNDING        BT-114  cac:LegalMonetaryTotal/cbc:PayableRoundingAmount
//   payable_amount          PAYABLE         BT-115  cac:LegalMonetaryTotal/cbc:PayableAmount
//   vat_breakdown[i].tax_amount   VBD_TAX   BT-117  cac:TaxSubtotal/cbc:TaxAmount, every row in document order, of the
//                                                   cac:TaxTotal read for BT-110
//   lines[i]                                        cac:InvoiceLine (Invoice) or cac:CreditNoteLine (CreditNote), in order
//     line_extension_amount LINE_EXT, LINE_NET_EXACT BT-131  cbc:LineExtensionAmount
//     invoiced_quantity     QTY             BT-129  cbc:InvoicedQuantity (Invoice) or cbc:CreditedQuantity (CreditNote)
//     price_amount          PRICE           BT-146  cac:Price/cbc:PriceAmount
//     base_quantity         BASE_QTY        BT-149  cac:Price/cbc:BaseQuantity
//     line_allowance_amount LINE_ALLOWANCE  Σ BT-136  cac:AllowanceCharge with cbc:ChargeIndicator false: Σ cbc:Amount
//     line_charge_amount    LINE_CHARGE     Σ BT-141  cac:AllowanceCharge with cbc:ChargeIndicator true: Σ cbc:Amount
// A field whose element is absent, or empty after trimming, is left out (the ruleset then defaults it or abstains, as it
// says). Two elements where the field takes one (two cbc:IssueDate) leave it out too, and the trace says so. LINE_ALLOWANCE_
// CHARGE_LIST is never written: the schema names no element for it; the sums above are BT-136 and BT-141 as the terms read.
// Amounts and quantities are written as JSON numbers carrying the document's own digits (a leading "+" dropped, "0" put
// before a bare "."); a value that is not a decimal is written as the string the document holds, so the engine sees it.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { args, attr, kid, kids, scanXml, textOf, UBL } from './lib.mjs'

export const MAPPING_ID = 'blind-shipping-1/ubl-to-extraction/1'
const { cac, cbc } = UBL
const DECIMAL = /^[+-]?(\d+(\.\d*)?|\.\d+)$/

/** A decimal lexical form as a JSON number token, or null when it is not a decimal. */
export function decimalToken(s) {
  const t = s.trim()
  if (!DECIMAL.test(t)) return null
  let v = t.replace(/^\+/, '')
  const neg = v.startsWith('-')
  if (neg) v = v.slice(1)
  if (v.startsWith('.')) v = '0' + v
  if (v.endsWith('.')) v = v.slice(0, -1)
  v = v.replace(/^0+(?=\d)/, '')
  return (neg && /[1-9]/.test(v) ? '-' : '') + v
}

/** Exact decimal sum of lexical forms (BigInt), as a lexical form. */
export function decimalSum(values) {
  let scale = 0
  for (const v of values) scale = Math.max(scale, (v.split('.')[1] ?? '').length)
  let total = 0n
  for (const v of values) {
    const neg = v.startsWith('-')
    const [i, f = ''] = v.replace(/^[-+]/, '').split('.')
    const n = BigInt((i || '0') + f.padEnd(scale, '0'))
    total += neg ? -n : n
  }
  const neg = total < 0n
  let digits = (neg ? -total : total).toString().padStart(scale + 1, '0')
  const out = scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits
  return (neg ? '-' : '') + out
}

/** A raw marker for a number token: JSON.stringify writes it as a string; `toJson` below unwraps it. */
const NUM = (token) => ({ __num: token })

function valueOf(xml, el, trace, field, path) {
  const t = textOf(xml, el)
  if (t === null || t.trim() === '') { trace.push({ field, path, read: null, note: t === null ? 'element has children' : 'empty' }); return undefined }
  trace.push({ field, path, read: t })
  return t.trim()
}

function amount(xml, el, trace, field, path) {
  const raw = valueOf(xml, el, trace, field, path)
  if (raw === undefined) return undefined
  const tok = decimalToken(raw)
  return tok === null ? raw : NUM(tok)
}

function one(xml, parent, ns, local, trace, field, path, read = amount) {
  if (!parent) { trace.push({ field, path, read: null, note: 'parent absent' }); return undefined }
  const all = kids(parent, ns, local)
  if (all.length === 0) { trace.push({ field, path, read: null, note: 'absent' }); return undefined }
  if (all.length > 1) { trace.push({ field, path, read: null, note: `${all.length} elements where the field takes one; left out` }); return undefined }
  return read(xml, all[0], trace, field, path)
}

const text = (xml, el, trace, field, path) => valueOf(xml, el, trace, field, path)

/** The mapping. Returns { root, extraction, trace } or throws when the root is not a UBL Invoice or CreditNote. */
export function extractUbl(xml) {
  const root = scanXml(xml)
  const isInvoice = root.ns === UBL.invoice && root.local === 'Invoice'
  const isCredit = root.ns === UBL.creditNote && root.local === 'CreditNote'
  if (!isInvoice && !isCredit) throw new Error(`root element {${root.ns}}${root.local} is not a UBL Invoice or CreditNote`)
  const trace = []
  const x = {}
  const put = (k, v) => { if (v !== undefined) x[k] = v }
  put('invoice_number', one(xml, root, cbc, 'ID', trace, 'invoice_number', 'cbc:ID', text))
  put('issue_date', one(xml, root, cbc, 'IssueDate', trace, 'issue_date', 'cbc:IssueDate', text))
  const currency = one(xml, root, cbc, 'DocumentCurrencyCode', trace, 'currency', 'cbc:DocumentCurrencyCode', text)
  put('currency', currency)
  const lmts = kids(root, cac, 'LegalMonetaryTotal')
  const lmt = lmts.length === 1 ? lmts[0] : null
  if (lmts.length > 1) trace.push({ field: 'cac:LegalMonetaryTotal', read: null, note: `${lmts.length} elements; every total left out` })
  const L = [['line_extension_amount', 'LineExtensionAmount'], ['allowance_total_amount', 'AllowanceTotalAmount'], ['charge_total_amount', 'ChargeTotalAmount'],
    ['tax_exclusive_amount', 'TaxExclusiveAmount'], ['tax_inclusive_amount', 'TaxInclusiveAmount'], ['prepaid_amount', 'PrepaidAmount'],
    ['payable_rounding_amount', 'PayableRoundingAmount'], ['payable_amount', 'PayableAmount']]
  for (const [k, local] of L) put(k, one(xml, lmt, cbc, local, trace, k, `cac:LegalMonetaryTotal/cbc:${local}`))
  if (lmt) {
    const ids = lmt.children.filter(c => c.ns === cbc).map(c => attr(c, 'currencyID')).filter(v => v !== null).map(v => v.trim())
    const distinct = [...new Set(ids)]
    if (distinct.length === 1) { x.amount_currency = distinct[0]; trace.push({ field: 'amount_currency', path: 'cac:LegalMonetaryTotal/*/@currencyID', read: distinct[0] }) }
    else if (distinct.length > 1) {
      const other = ids.find(v => v !== currency) ?? distinct[0]
      x.amount_currency = other
      trace.push({ field: 'amount_currency', path: 'cac:LegalMonetaryTotal/*/@currencyID', read: other, note: `the totals carry ${distinct.join(', ')}; the first that is not BT-5 is read` })
    } else trace.push({ field: 'amount_currency', path: 'cac:LegalMonetaryTotal/*/@currencyID', read: null, note: 'absent' })
  }
  const totals = kids(root, cac, 'TaxTotal')
  let tt = null
  if (currency !== undefined) {
    const match = totals.filter(t => kids(t, cbc, 'TaxAmount').some(a => (attr(a, 'currencyID') ?? '').trim() === currency))
    if (match.length === 1) tt = match[0]
    else trace.push({ field: 'tax_amount', path: 'cac:TaxTotal[cbc:TaxAmount/@currencyID = BT-5]', read: null, note: match.length ? `${match.length} such cac:TaxTotal; left out` : 'no cac:TaxTotal in the invoice currency' })
  } else if (totals.length === 1) tt = totals[0]
  else trace.push({ field: 'tax_amount', path: 'cac:TaxTotal', read: null, note: `no BT-5 and ${totals.length} cac:TaxTotal; left out` })
  if (tt) {
    put('tax_amount', one(xml, tt, cbc, 'TaxAmount', trace, 'tax_amount', 'cac:TaxTotal/cbc:TaxAmount'))
    const subs = kids(tt, cac, 'TaxSubtotal')
    if (subs.length) x.vat_breakdown = subs.map((s, i) => { const r = {}; const v = one(xml, s, cbc, 'TaxAmount', trace, `vat_breakdown[${i}].tax_amount`, `cac:TaxTotal/cac:TaxSubtotal[${i + 1}]/cbc:TaxAmount`); if (v !== undefined) r.tax_amount = v; return r })
  }
  const lineName = isInvoice ? 'InvoiceLine' : 'CreditNoteLine'
  const qtyName = isInvoice ? 'InvoicedQuantity' : 'CreditedQuantity'
  const lines = kids(root, cac, lineName)
  if (lines.length) {
    x.lines = lines.map((ln, i) => {
      const r = {}
      const p = `cac:${lineName}[${i + 1}]`
      const set = (k, v) => { if (v !== undefined) r[k] = v }
      set('line_extension_amount', one(xml, ln, cbc, 'LineExtensionAmount', trace, `lines[${i}].line_extension_amount`, `${p}/cbc:LineExtensionAmount`))
      set('invoiced_quantity', one(xml, ln, cbc, qtyName, trace, `lines[${i}].invoiced_quantity`, `${p}/cbc:${qtyName}`))
      const price = kid(ln, cac, 'Price')
      set('price_amount', one(xml, price, cbc, 'PriceAmount', trace, `lines[${i}].price_amount`, `${p}/cac:Price/cbc:PriceAmount`))
      if (price && kids(price, cbc, 'BaseQuantity').length) set('base_quantity', one(xml, price, cbc, 'BaseQuantity', trace, `lines[${i}].base_quantity`, `${p}/cac:Price/cbc:BaseQuantity`))
      const sums = { false: [], true: [] }
      let unreadable = false
      for (const ac of kids(ln, cac, 'AllowanceCharge')) {
        const ind = (textOf(xml, kid(ac, cbc, 'ChargeIndicator')) ?? '').trim()
        const amt = (textOf(xml, kid(ac, cbc, 'Amount')) ?? '').trim()
        const which = ind === 'true' || ind === '1' ? 'true' : ind === 'false' || ind === '0' ? 'false' : null
        const tok = decimalToken(amt)
        if (which === null || tok === null) { unreadable = true; trace.push({ field: `lines[${i}].allowance/charge`, path: `${p}/cac:AllowanceCharge`, read: null, note: `indicator "${ind}", amount "${amt}": not read; both sums left out` }); continue }
        sums[which].push(tok)
      }
      if (!unreadable) {
        if (sums.false.length) { r.line_allowance_amount = NUM(decimalSum(sums.false)); trace.push({ field: `lines[${i}].line_allowance_amount`, path: `${p}/cac:AllowanceCharge[ChargeIndicator=false]/cbc:Amount`, read: sums.false.join(' + ') }) }
        if (sums.true.length) { r.line_charge_amount = NUM(decimalSum(sums.true)); trace.push({ field: `lines[${i}].line_charge_amount`, path: `${p}/cac:AllowanceCharge[ChargeIndicator=true]/cbc:Amount`, read: sums.true.join(' + ') }) }
      }
      return r
    })
  }
  return { root: isInvoice ? 'Invoice' : 'CreditNote', extraction: x, trace }
}

/** JSON text with number tokens written as the document's digits. */
export function toJson(x) {
  const marks = []
  const s = JSON.stringify(x, (k, v) => (v && typeof v === 'object' && '__num' in v ? `\u0000NUM${marks.push(v.__num) - 1}\u0000` : v), 1)
  return s.replace(/"\\u0000NUM(\d+)\\u0000"/g, (_, i) => marks[Number(i)]) + '\n'
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const a = args(process.argv.slice(2))
  const doOne = (inPath, outPath) => {
    const r = extractUbl(readFileSync(inPath, 'utf8'))
    const json = toJson(r.extraction)
    if (!outPath) { process.stdout.write(json); return }
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, json)
    writeFileSync(outPath.replace(/\.json$/, '') + '.trace.json', JSON.stringify({ mapping: MAPPING_ID, root: r.root, trace: r.trace }, null, 1) + '\n')
  }
  if (a.in) doOne(a.in, a.out)
  else if (a.items) {
    const items = JSON.parse(readFileSync(a.items, 'utf8'))
    for (const it of items) doOne(join(a.base ?? '.', it.file), join(a.out, `${it.key ?? it.id.replace(/[^\w.-]+/g, '_')}.json`))
    console.error(`${items.length} extraction(s) written under ${a.out} by ${MAPPING_ID}`)
  } else { console.error('usage: einvoice-extract.mjs --in <file.xml> [--out <file.json>] | --items <items.json> --base <dir> --out <dir>'); process.exit(3) }
}
