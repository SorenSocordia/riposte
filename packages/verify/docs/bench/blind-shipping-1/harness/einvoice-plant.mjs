// blind-shipping-1, e-invoice arm (PREREG.md sections 4.2 and 6): the 40 planted files.
// NOT RUN before the labels exist; run by the labeller, before any engine call on this arm.
//
//   node harness/einvoice-plant.mjs [--results results/einvoice] [--work tmp/einvoice-clones] [--python python] [--schxslt <xsl>]
//
// Copies of files that are valid for peppol-en16931@0.3.0 (no rule it cites fires) are drawn in section 6's order (seed of
// arm "einvoice"; item id "<repository>/<path>"). Eight operators, five files each, taken in this order, one change per copy:
//   BR-CO-10  the sum of line net amounts (cac:LegalMonetaryTotal/cbc:LineExtensionAmount) plus one currency unit
//   BR-CO-13  the total without VAT (cac:LegalMonetaryTotal/cbc:TaxExclusiveAmount) plus one
//   BR-CO-14  the VAT total (cbc:TaxAmount of the cac:TaxTotal in the invoice currency) plus one
//   BR-CO-15  the total with VAT (cac:LegalMonetaryTotal/cbc:TaxInclusiveAmount) plus one
//   BR-CO-16  the payable amount (cac:LegalMonetaryTotal/cbc:PayableAmount) with two adjacent digits swapped: the rightmost
//             pair of unequal adjacent digits on one side of the decimal point (fraction first), never making a leading zero
//   PEPPOL-EN16931-R120  the first line's net amount (cbc:LineExtensionAmount of the first invoice or credit note line) plus one
//   BR-05     the invoice currency (cbc:DocumentCurrencyCode) removed
//   BR-03     the issue date (cbc:IssueDate) removed
// "Plus one" adds 1 to the written decimal and keeps its number of decimals. A file that cannot take an operator (the
// element absent or repeated, a value that is not a decimal, no pair of digits to swap) is skipped for the next (section 6).
// Each planted file is run through both validators; it is kept only if the intended rule fires, otherwise it is replaced by
// the next draw (section 4.2). A file is used for one operator at most. Every change is made in place on the file's text:
// every other byte stays as it was.
//
// Writes <results>/planted/planted-manifest.json (the planted set, the draws skipped and replaced, the seed) and the planted
// files, and appends the manifest's sha256 to the run's ledger as the arm's planted set (section 3).
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { args, attr, drawOrder, kid, kids, ledgerAppend, readJson, RUN_DIR, scanXml, seedFor, sha256, textOf, UBL, writeNew } from './lib.mjs'
import { decimalSum, decimalToken } from './einvoice-extract.mjs'
import { citesNow, labelFile, runValidators } from './einvoice-validate.mjs'

const { cac, cbc } = UBL
export const PER_OPERATOR = 5

const replaceText = (xml, el, value) => xml.slice(0, el.textStart) + value + xml.slice(el.textEnd)
function removeElement(xml, el) {
  const lineStart = xml.lastIndexOf('\n', el.start - 1) + 1
  const nl = xml.indexOf('\n', el.end)
  const lineEnd = nl < 0 ? xml.length : nl + 1
  if (/^[ \t]*$/.test(xml.slice(lineStart, el.start)) && /^[ \t\r]*\n?$/.test(xml.slice(el.end, lineEnd))) return xml.slice(0, lineStart) + xml.slice(lineEnd)
  return xml.slice(0, el.start) + xml.slice(el.end)
}
const only = (parent, ns, local) => { const k = parent ? kids(parent, ns, local) : []; return k.length === 1 ? k[0] : null }
function plusOne(xml, el) {
  if (!el || el.children.length) return null
  const raw = xml.slice(el.textStart, el.textEnd)
  const tok = decimalToken(raw)
  if (tok === null) return null
  const scale = (tok.split('.')[1] ?? '').length
  const sum = decimalSum([tok, scale ? `1.${'0'.repeat(scale)}` : '1'])
  return { old: raw, value: sum }
}
/** The rightmost pair of unequal adjacent digits on one side of the point, fraction first; null when there is none. */
export function swapAdjacent(dec) {
  const m = dec.match(/^([+-]?)(\d*)(?:\.(\d*))?$/)
  if (!m) return null
  const [, sign, int, frac = ''] = m
  const swapIn = (s, isInt) => {
    for (let i = s.length - 2; i >= 0; i--) {
      if (s[i] === s[i + 1]) continue
      if (isInt && i === 0 && s[1] === '0' && s.length > 1) continue
      return s.slice(0, i) + s[i + 1] + s[i] + s.slice(i + 2)
    }
    return null
  }
  const f = swapIn(frac, false)
  if (f !== null) return `${sign}${int}.${f}`
  const n = swapIn(int, true)
  if (n !== null) return `${sign}${n}${dec.includes('.') ? `.${frac}` : ''}`
  return null
}

/** The BT-110 tax total: the one cac:TaxTotal whose cbc:TaxAmount is in the invoice currency (as the extraction reads it). */
function bt110(xml, root) {
  const cur = textOf(xml, only(root, cbc, 'DocumentCurrencyCode'))?.trim()
  const totals = kids(root, cac, 'TaxTotal')
  if (!cur) return totals.length === 1 ? totals[0] : null
  const m = totals.filter(t => kids(t, cbc, 'TaxAmount').some(a => (attr(a, 'currencyID') ?? '').trim() === cur))
  return m.length === 1 ? m[0] : null
}

export const OPERATORS = [
  { rule: 'BR-CO-10', what: 'sum of line net amounts plus one', at: (x, r) => only(only(r, cac, 'LegalMonetaryTotal'), cbc, 'LineExtensionAmount'), op: 'plus' },
  { rule: 'BR-CO-13', what: 'total without VAT plus one', at: (x, r) => only(only(r, cac, 'LegalMonetaryTotal'), cbc, 'TaxExclusiveAmount'), op: 'plus' },
  { rule: 'BR-CO-14', what: 'VAT total plus one', at: (x, r) => only(bt110(x, r), cbc, 'TaxAmount'), op: 'plus' },
  { rule: 'BR-CO-15', what: 'total with VAT plus one', at: (x, r) => only(only(r, cac, 'LegalMonetaryTotal'), cbc, 'TaxInclusiveAmount'), op: 'plus' },
  { rule: 'BR-CO-16', what: 'payable amount with two adjacent digits swapped', at: (x, r) => only(only(r, cac, 'LegalMonetaryTotal'), cbc, 'PayableAmount'), op: 'swap' },
  { rule: 'PEPPOL-EN16931-R120', what: "first line's net amount plus one", at: (x, r) => { const line = kids(r, cac, r.local === 'Invoice' ? 'InvoiceLine' : 'CreditNoteLine')[0]; return line ? only(line, cbc, 'LineExtensionAmount') : null }, op: 'plus' },
  { rule: 'BR-05', what: 'invoice currency removed', at: (x, r) => only(r, cbc, 'DocumentCurrencyCode'), op: 'remove' },
  { rule: 'BR-03', what: 'issue date removed', at: (x, r) => only(r, cbc, 'IssueDate'), op: 'remove' },
]

/** One operator on one file's text: { xml, change } or null when the file cannot take it. */
export function applyOperator(op, xml) {
  let root
  try { root = scanXml(xml) } catch { return null }
  const el = op.at(xml, root)
  if (!el || el.children.length) return null
  if (op.op === 'remove') return { xml: removeElement(xml, el), change: { element: el.qname, removed: xml.slice(el.start, el.end) } }
  const raw = xml.slice(el.textStart, el.textEnd)
  if (decimalToken(raw) === null) return null
  if (op.op === 'plus') { const p = plusOne(xml, el); return p ? { xml: replaceText(xml, el, p.value), change: { element: el.qname, old: raw, new: p.value } } : null }
  const sw = swapAdjacent(raw.trim())
  if (sw === null) return null
  return { xml: replaceText(xml, el, raw.replace(raw.trim(), sw)), change: { element: el.qname, old: raw, new: sw } }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const a = args(process.argv.slice(2))
  const R = resolve(a.results ?? join(RUN_DIR, 'results', 'einvoice'))
  const WORK = resolve(a.work ?? join(RUN_DIR, 'tmp', 'einvoice-clones'))
  const P = join(R, 'planted')
  if (existsSync(join(P, 'planted-manifest.json'))) { console.error('the planted set is made once'); process.exit(1) }
  const fetchTags = readJson(join(R, 'fetch-tags.json')), manifest = readJson(join(R, 'fetch-manifest.json')), labels = readJson(join(R, 'labels.json'))
  const byId = new Map(manifest.selected.map(s => [s.id, s]))
  const eligible = labels.files.filter(f => f.decided && f.valid['0.3.0']).map(f => f.id)
  const seed = await seedFor('einvoice')
  const order = drawOrder(seed.seed, eligible)
  const used = new Set(), kept = [], replaced = [], cannotTake = []
  const cites = citesNow()
  let batchNo = 0
  for (const op of OPERATORS) {
    let pos = 0, got = 0
    while (got < PER_OPERATOR && pos < order.length) {
      const batch = []
      while (batch.length < (PER_OPERATOR - got) * 2 && pos < order.length) {
        const id = order[pos++]
        if (used.has(id)) continue
        const base = byId.get(id)
        const r = applyOperator(op, readFileSync(join(R, base.file), 'utf8'))
        if (!r) { cannotTake.push({ rule: op.rule, id }); continue }
        const key = `C${String(++batchNo).padStart(4, '0')}`
        mkdirSync(join(P, 'candidates'), { recursive: true })
        writeFileSync(join(P, 'candidates', `${key}.xml`), r.xml)
        batch.push({ key, id, base, r })
      }
      if (!batch.length) break
      const { byKey } = runValidators({ files: batch.map(b => ({ key: b.key, path: join(P, 'candidates', `${b.key}.xml`) })), fetchTags, work: WORK, python: a.python ?? 'python', schxslt: a.schxslt ?? null, out: join(P, `svrl-${batch[0].key}`) })
      for (const b of batch) {
        const lab = labelFile(byKey[b.key], cites)
        const fires = lab.decided && lab.fires[op.rule] === true
        if (got >= PER_OPERATOR) continue // validated past the need: never drawn for this operator, still free for the next
        if (!fires) { replaced.push({ rule: op.rule, id: b.id, candidate: b.key, change: b.r.change, why: lab.decided ? 'the intended rule does not fire' : 'a validator could not process it' }); continue }
        used.add(b.id)
        got++
        const k = `P${String(kept.length + 1).padStart(2, '0')}`
        mkdirSync(join(P, 'files'), { recursive: true })
        writeFileSync(join(P, 'files', `${k}.xml`), b.r.xml)
        kept.push({ key: k, operator: op.what, intended_rule: op.rule, base_key: b.base.key, base_id: b.id, base_sha256: b.base.sha256, change: b.r.change, file: `files/${k}.xml`, sha256: sha256(Buffer.from(b.r.xml, 'utf8')), candidate: b.key, labels: lab })
      }
    }
    if (got < PER_OPERATOR) console.error(`${op.rule}: only ${got} of ${PER_OPERATOR} planted; the valid files ran out (reported as it is)`)
  }
  const out = { format: 'blind-shipping-1/einvoice-planted/1', seed: { arm: 'einvoice', ...seed }, eligible_valid_files: eligible.length, per_operator: PER_OPERATOR,
    counts: { kept: kept.length, replaced: replaced.length, cannot_take: cannotTake.length }, kept, replaced, cannot_take: cannotTake }
  const h = writeNew(join(P, 'planted-manifest.json'), out)
  if (!manifest.dry_run) ledgerAppend({ arm: 'einvoice', event: 'hashed', kind: 'planted', sha256: h })
  console.error(`planted ${kept.length} (replaced ${replaced.length}, skipped ${cannotTake.length}); planted-manifest.json sha256 ${h}`)
}
