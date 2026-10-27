// BPI Challenge 2019 harness (PREREG v0 §3-§6 as amended by Amendment A). Streams the XES, maps each case (purchase item)
// to receipt / invoice message counts, runs verify's `reconcile` (frozen snapshot of products/verify/dist, read-only)
// under bpi-threeway-messages@1.0.0, and writes one JSON line per item.
//   node --max-old-space-size=2048 run.mjs --out results/run-blind.jsonl     (scored set: traces >= 1500)
//   node --max-old-space-size=2048 run.mjs --dev --out results/dev.jsonl     (dev slice only: traces < 1500)
import { createWriteStream } from 'node:fs'
import { reconcile } from './vendor/verify-dist/reconcile/index.js'
import { traces } from './xes.mjs'
import { MAPPING as M } from './mapping.mjs'

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d }
const DATA = arg('--data', 'data/BPI_Challenge_2019.xes')
const DEV = process.argv.includes('--dev')
const DEV_SLICE = 1500
const FIXED_NOW = () => new Date('2026-10-03T00:00:00.000Z') // determinism: issued_at pinned

// ---- ruleset bpi-threeway-messages@1.0.0: one check list per category; exact integer comparison ------------------
const FIELDS = { gr: { doc: 'receipt', paths: ['messages'] }, inv: { doc: 'invoice', paths: ['messages'] } }
const R1M = { code: 'R1M_INVOICES_LE_RECEIPTS', name: 'Every posted invoice receipt has a goods-receipt message', left: 'inv', op: '<=', right: 'gr', tol: 0.01, field: 'invoice.messages' }
const R0M = { code: 'R0M_CONSIGNMENT_NO_INVOICE', name: 'Consignment item carries no invoice on PO level', left: 'inv', op: '=', right: '0', tol: 0.01, field: 'invoice.messages' }
const ruleset = (cat, checks) => ({ id: `bpi-threeway-messages.${cat}`, version: '1.0.0', domain: 'procure-to-pay', name: `BPI 2019 message-level three-way (${cat})`, documents: ['receipt', 'invoice'], fields: FIELDS, checks, tolerance: { rel: 0, absCap: 0 } })
const RULESETS = { threeway_after: ruleset('threeway_after', [R1M]), threeway_before: ruleset('threeway_before', [R1M]), consignment: ruleset('consignment', [R0M]) }

// ---- category (PREREG §4) -----------------------------------------------------------------------------------------
function category(a) {
  const byName = M.categories[a['Item Category']]
  if (!byName) return { cat: null, why: 'CATEGORY_CONFLICT' }
  const griv = a['GR-Based Inv. Verif.'], gr = a['Goods Receipt']
  const consign = M.consignmentItemTypes.includes(a['Item Type'])
  const byFlags = griv === true && gr === true ? 'threeway_after'
    : griv === false && gr === true ? (consign ? 'consignment' : 'threeway_before')
      : griv === false && gr === false ? 'twoway' : null
  return { cat: byName, why: byFlags === byName ? null : 'CATEGORY_CONFLICT' }
}

const inList = (list, act) => list.includes(act)
const LEDGER = new Set([...M.receiptAdd, ...M.receiptRemove, ...M.invoiceAdd, ...M.invoiceRemove, ...M.clear])

export function mapItem(t) {
  const a = t.attrs, ev = t.events
  const { cat, why: catWhy } = category(a)
  let gr = 0, grX = 0, ses = 0, ir = 0, irX = 0, sub = 0, subX = 0, clr = 0, block = false
  let createTs = null, createVal = null
  const vals = new Set()
  for (const e of ev) {
    const act = e['concept:name']
    vals.add(e[M.valueKey])
    if (inList(M.poCreate, act) && createTs === null) { createTs = e['time:timestamp']; createVal = e[M.valueKey] ?? null }
    else if (inList(M.receiptAdd, act)) gr++
    else if (inList(M.receiptRemove, act)) grX++
    else if (inList(M.serviceEntry, act)) ses++
    else if (inList(M.invoiceAdd, act)) ir++
    else if (inList(M.invoiceRemove, act)) irX++
    else if (inList(M.subsequentAdd, act)) sub++
    else if (inList(M.subsequentRemove, act)) subX++
    else if (inList(M.clear, act)) clr++
    if (inList(M.paymentBlock, act)) block = true
  }
  const grIn = gr === 0 && ses > 0 ? ses : gr // Q2: a service entry sheet stands in for a receipt only where no GR exists
  const TS = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/ // ISO UTC as in the file; anything else would break string ordering
  const badTs = ev.some((e) => typeof e['time:timestamp'] !== 'string' || !TS.test(e['time:timestamp']))
  const truncated = createTs === null || ev.some((e) => LEDGER.has(e['concept:name']) && e['time:timestamp'] < createTs)
  return {
    case: a['concept:name'], cat, catWhy, truncated, badTs,
    n: { gr, grX, ses, ir, irX, sub, subX, clr, grNet: grIn - grX, irNet: ir - irX, subNet: sub - subX },
    po_value: createVal, value_constant: vals.size === 1, block, cancelInv: irX > 0, uncleared: ir > clr,
  }
}

export function decide(t) {
  const m = mapItem(t)
  const held = m.block || m.cancelInv || m.uncleared
  const base = { i: t.index, case: m.case, cat: m.cat ?? `UNKNOWN:${t.attrs['Item Category']}`, n: m.n, po_value: m.po_value, value_constant: m.value_constant,
    log: { held, block: m.block, cancel: m.cancelInv, uncleared: m.uncleared } }
  if (m.n.ir + m.n.sub === 0) return { ...base, dec: 'NOT_INVOICED', why: [], chk: {} }
  const abstain = (why) => ({ ...base, dec: 'ABSTAIN', why: [why], chk: {} })
  if (m.catWhy) return abstain(m.catWhy)
  if (m.cat === 'twoway') return abstain('NO_AMOUNTS_FOR_TWO_WAY')
  if (m.badTs) return abstain('TIMESTAMP_FORMAT')
  if (m.truncated) return abstain('TRUNCATED')
  // only the operands this category uses (dev slice: Cancel Subsequent Invoice can appear with no Record Subsequent Invoice)
  if (m.n.grNet < 0 || m.n.irNet < 0 || (m.cat === 'consignment' && m.n.subNet < 0)) return abstain('NEGATIVE_NET')
  const inv = m.cat === 'consignment' ? m.n.irNet + m.n.subNet : m.n.irNet
  const v = reconcile({ receipt: { item: m.case, messages: m.n.grNet }, invoice: { item: m.case, messages: inv } }, RULESETS[m.cat], { now: FIXED_NOW })
  const chk = {}, vari = {}
  for (const c of v.claims) { chk[c.rule_id] = c.outcome; if (c.variance !== undefined) vari[c.rule_id] = c.variance }
  const outs = Object.values(chk)
  const dec = outs.includes('FAIL') ? 'FAIL' : outs.length && outs.every((o) => o === 'PASS') ? 'PASS' : 'ABSTAIN'
  const why = dec === 'ABSTAIN' ? v.claims.filter((c) => c.outcome === 'INSUFFICIENT_DATA').map((c) => c.insufficiency?.reason ?? 'INSUFFICIENT') : []
  const rem = (v.remedies ?? []).map((r) => ({ kind: r.kind, clears: r.clears, detail: r.detail }))
  return { ...base, dec, why, chk, var: vari, vid: v.verdict_id, vout: v.outcome, rem }
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('/run.mjs')) {
  const out = createWriteStream(arg('--out', DEV ? 'results/dev.jsonl' : 'results/run-blind.jsonl'))
  let n = 0
  for await (const t of traces(DATA, DEV ? { limit: DEV_SLICE } : {})) {
    if (!DEV && t.index < DEV_SLICE) continue
    if (!out.write(JSON.stringify(decide(t)) + '\n')) await new Promise((r) => out.once('drain', r))
    n++
  }
  await new Promise((r) => out.end(r))
  console.error(`wrote ${n} items`)
}
